'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PageLoader } from '@/components/ui/page-loader';
import { Loader2, Save, RefreshCw, Edit, Trash2, Search, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { cn } from '@/lib/utils';

type SalaryComponent = {
    id: string;
    salaryId: number;
    name: string;
    type: 'EARNINGS' | 'DEDUCTIONS';
    defaultPercent: number | string | null;
    percentBasis: 'BASIC' | 'GROSS' | null;
    maxAmount: number | string | null;
    ctcEligibilityLimit: number | string | null;
};

export function SalaryDetailsClient() {
    const { toast } = useToast();
    const [components, setComponents] = useState<SalaryComponent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        salaryId: '',
        name: '',
        type: 'EARNINGS' as 'EARNINGS' | 'DEDUCTIONS',
        // Percentage-based deduction (e.g. PF, ESI) — only used when type is
        // DEDUCTIONS. Empty defaultPercent = stays a flat manual amount.
        defaultPercent: '',
        percentBasis: 'BASIC' as 'BASIC' | 'GROSS',
        // Optional ceiling on the percentage amount. Empty = no cap.
        maxAmount: '',
        // Optional: no deduction when Month CTC Pay is above this (e.g. ESI 21,000).
        ctcEligibilityLimit: '',
    });

    const fetchComponents = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<SalaryComponent[]>('/payroll/salary-details');
            if (res.success && res.data) {
                setComponents(res.data);
            }
        } catch (error) {
            console.error('Failed to fetch components:', error);
            toast({
                title: 'Error',
                description: 'Failed to load salary components.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchComponents();
    }, []);

    const metrics = useMemo(() => {
        const earnings = components.filter(c => c.type === 'EARNINGS').length;
        const deductions = components.filter(c => c.type === 'DEDUCTIONS').length;
        return { total: components.length, earnings, deductions };
    }, [components]);

    const nextSalaryId = useMemo(() => {
        if (components.length === 0) return 1;
        const maxId = Math.max(...components.map((c) => c.salaryId));
        return maxId + 1;
    }, [components]);

    useEffect(() => {
        if (!editingId) {
            setFormData(prev => ({ ...prev, salaryId: nextSalaryId.toString() }));
        }
    }, [nextSalaryId, editingId]);

    const filteredComponents = useMemo(() => {
        return components.filter(c =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.salaryId.toString().includes(searchTerm)
        );
    }, [components, searchTerm]);

    const handleSave = async () => {
        if (!formData.salaryId || !formData.name) {
            toast({
                title: 'Validation Error',
                description: 'Please fill in all required fields.',
                variant: 'destructive',
            });
            return;
        }

        const trimmedPercent = formData.defaultPercent.trim();
        if (trimmedPercent && (Number.isNaN(Number(trimmedPercent)) || Number(trimmedPercent) < 0 || Number(trimmedPercent) > 100)) {
            toast({ title: 'Validation Error', description: 'Default % must be a number between 0 and 100.', variant: 'destructive' });
            return;
        }

        const trimmedMax = formData.maxAmount.trim();
        if (trimmedMax && (Number.isNaN(Number(trimmedMax)) || Number(trimmedMax) <= 0)) {
            toast({ title: 'Validation Error', description: 'Maximum Amount must be a number greater than 0.', variant: 'destructive' });
            return;
        }

        const trimmedLimit = formData.ctcEligibilityLimit.trim();
        if (trimmedLimit && (Number.isNaN(Number(trimmedLimit)) || Number(trimmedLimit) <= 0)) {
            toast({ title: 'Validation Error', description: 'CTC limit must be a number greater than 0.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                salaryId: parseInt(formData.salaryId),
                name: formData.name,
                type: formData.type,
                id: editingId || undefined,
                defaultPercent: formData.type === 'DEDUCTIONS' && trimmedPercent ? Number(trimmedPercent) : null,
                percentBasis: formData.type === 'DEDUCTIONS' && trimmedPercent ? formData.percentBasis : null,
                maxAmount: formData.type === 'DEDUCTIONS' && trimmedPercent && trimmedMax ? Number(trimmedMax) : null,
                ctcEligibilityLimit: formData.type === 'DEDUCTIONS' && trimmedPercent && trimmedLimit ? Number(trimmedLimit) : null,
            };

            const res = await apiClient.post('/payroll/salary-details', payload);
            if (res.success) {
                toast({
                    title: 'Success',
                    description: editingId ? 'Salary component updated.' : 'Salary component created.',
                    className: "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800",
                });
                setFormData({ salaryId: '', name: '', type: 'EARNINGS', defaultPercent: '', percentBasis: 'BASIC', maxAmount: '', ctcEligibilityLimit: '' });
                setEditingId(null);
                fetchComponents();
            } else {
                toast({
                    title: 'Error',
                    description: res.error || 'Failed to save component.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = (comp: SalaryComponent) => {
        setFormData({
            salaryId: comp.salaryId.toString(),
            name: comp.name,
            type: comp.type,
            defaultPercent: comp.defaultPercent !== null && comp.defaultPercent !== undefined ? String(comp.defaultPercent) : '',
            percentBasis: comp.percentBasis ?? 'BASIC',
            maxAmount: comp.maxAmount !== null && comp.maxAmount !== undefined ? String(comp.maxAmount) : '',
            ctcEligibilityLimit: comp.ctcEligibilityLimit !== null && comp.ctcEligibilityLimit !== undefined ? String(comp.ctcEligibilityLimit) : '',
        });
        setEditingId(comp.id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this component?')) return;

        try {
            const res = await apiClient.delete(`/payroll/salary-details?id=${id}`);
            if (res.success) {
                toast({
                    title: 'Deleted',
                    description: 'Salary component removed.',
                });
                fetchComponents();
            } else {
                toast({
                    title: 'Error',
                    description: res.error || 'Failed to delete component.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'An unexpected error occurred.',
                variant: 'destructive',
            });
        }
    };

    const handleReset = () => {
        setFormData({ salaryId: '', name: '', type: 'EARNINGS', defaultPercent: '', percentBasis: 'BASIC', maxAmount: '', ctcEligibilityLimit: '' });
        setEditingId(null);
        setSearchTerm('');
    };

    return (
        <div className="space-y-6">
            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricCard
                    title="Total Components"
                    value={metrics.total.toString()}
                    subtitle="Earnings & Deductions"
                    icon={DollarSign}
                    gradient="blue"
                />
                <MetricCard
                    title="Earnings"
                    value={metrics.earnings.toString()}
                    subtitle="Income types"
                    icon={TrendingUp}
                    gradient="green"
                />
                <MetricCard
                    title="Deductions"
                    value={metrics.deductions.toString()}
                    subtitle="Expense types"
                    icon={TrendingDown}
                    gradient="rose"
                />
            </div>

            {/* Entry Form */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4 rounded-t-xl">
                    <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                        {editingId ? <Save className="h-5 w-5" /> : <Save className="h-5 w-5" />}
                        {editingId ? 'Edit Salary Component' : 'Add New Component'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="space-y-2.5">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Salary Id</Label>
                            <Input
                                type="number"
                                placeholder="e.g. 1"
                                value={formData.salaryId}
                                readOnly
                                className="bg-green-50 dark:bg-sidebar-accent/50 font-bold text-primary cursor-not-allowed border-primary/20 dark:border-sidebar-accent h-12 text-lg"
                            />
                        </div>
                        <div className="space-y-2.5">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Salary Name</Label>
                            <Input
                                placeholder="e.g. Basic Salary"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent h-12 shadow-sm focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                        <div className="space-y-4">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Salary Type</Label>
                            <div className="flex gap-4">
                                <div
                                    onClick={() => setFormData({ ...formData, type: 'EARNINGS' })}
                                    className={cn(
                                        "flex flex-1 items-center space-x-3 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm group/item",
                                        formData.type === 'EARNINGS'
                                            ? "border-primary bg-green-50/50 ring-2 ring-primary/20 dark:bg-brand-green-darker/20 shadow-brand-green-tint dark:shadow-none"
                                            : "border-primary/20 dark:border-sidebar-accent bg-white dark:bg-green-950 hover:border-primary/30 dark:hover:border-sidebar-accent"
                                    )}
                                >
                                    <div className={cn(
                                        "h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all",
                                        formData.type === 'EARNINGS' ? "border-primary bg-primary" : "border-primary/30 dark:border-sidebar-accent group-hover/item:border-slate-400"
                                    )}>
                                        {formData.type === 'EARNINGS' && <div className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" />}
                                    </div>
                                    <span className={cn(
                                        "font-bold text-sm select-none",
                                        formData.type === 'EARNINGS' ? "text-sidebar-accent dark:text-primary" : "text-sidebar-accent dark:text-slate-400"
                                    )}>Earnings</span>
                                </div>

                                <div
                                    onClick={() => setFormData({ ...formData, type: 'DEDUCTIONS' })}
                                    className={cn(
                                        "flex flex-1 items-center space-x-3 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer shadow-sm group/item",
                                        formData.type === 'DEDUCTIONS'
                                            ? "border-primary bg-green-50/50 ring-2 ring-primary/20 dark:bg-brand-green-darker/20 shadow-brand-green-tint dark:shadow-none"
                                            : "border-primary/20 dark:border-sidebar-accent bg-white dark:bg-green-950 hover:border-primary/30 dark:hover:border-sidebar-accent"
                                    )}
                                >
                                    <div className={cn(
                                        "h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all",
                                        formData.type === 'DEDUCTIONS' ? "border-primary bg-primary" : "border-primary/30 dark:border-sidebar-accent group-hover/item:border-slate-400"
                                    )}>
                                        {formData.type === 'DEDUCTIONS' && <div className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" />}
                                    </div>
                                    <span className={cn(
                                        "font-bold text-sm select-none",
                                        formData.type === 'DEDUCTIONS' ? "text-sidebar-accent dark:text-primary" : "text-sidebar-accent dark:text-slate-400"
                                    )}>Deductions</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {formData.type === 'DEDUCTIONS' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8 pt-8 border-t border-slate-100 dark:border-sidebar-accent">
                            <div className="space-y-2.5">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Default % <span className="font-normal text-slate-400">(optional — e.g. PF, ESI)</span>
                                </Label>
                                <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    placeholder="Leave blank for a flat manual amount"
                                    value={formData.defaultPercent}
                                    onChange={(e) => setFormData({ ...formData, defaultPercent: e.target.value })}
                                    className="bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent h-12 shadow-sm focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                            {formData.defaultPercent.trim() && (
                                <div className="space-y-2.5">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Basis</Label>
                                    <Select value={formData.percentBasis} onValueChange={(v) => setFormData({ ...formData, percentBasis: v as 'BASIC' | 'GROSS' })}>
                                        <SelectTrigger className="h-12 bg-white dark:bg-brand-green-darker"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="BASIC">% of Actual Basic (e.g. PF)</SelectItem>
                                            <SelectItem value="GROSS">% of Actual Gross (e.g. ESI)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {formData.defaultPercent.trim() && (
                                <div className="space-y-2.5">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Maximum Amount (₹) <span className="font-normal text-slate-400">(optional cap)</span>
                                    </Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Leave blank for no cap"
                                        value={formData.maxAmount}
                                        onChange={(e) => setFormData({ ...formData, maxAmount: e.target.value })}
                                        className="bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent h-12 shadow-sm focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                            )}
                            {formData.defaultPercent.trim() && (
                                <div className="space-y-2.5">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Applicable up to Month CTC (₹) <span className="font-normal text-slate-400">(optional — e.g. ESI 21,000)</span>
                                    </Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Leave blank to apply at any CTC"
                                        value={formData.ctcEligibilityLimit}
                                        onChange={(e) => setFormData({ ...formData, ctcEligibilityLimit: e.target.value })}
                                        className="bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent h-12 shadow-sm focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex gap-4 mt-8 pt-8 border-t border-slate-100 dark:border-sidebar-accent">
                        <Button
                            onClick={handleSave}
                            disabled={isSaving || !formData.salaryId || !formData.name || !formData.type}
                            className="h-12 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/20 min-w-[140px] font-bold text-base transition-all hover:scale-[1.02] active:scale-95"
                        >
                            {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                            {editingId ? 'Update Component' : 'Save Component'}
                        </Button>
                        <Button
                            onClick={handleReset}
                            variant="outline"
                            className="h-12 border-primary/20 dark:border-sidebar-accent hover:bg-green-50 dark:hover:bg-sidebar-accent min-w-[120px] font-semibold transition-all"
                        >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Reset Form
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Components List */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="border-b bg-green-50/50 dark:bg-sidebar-accent/50 flex flex-row items-center justify-between py-4">
                    <CardTitle className="text-lg font-semibold text-sidebar-accent dark:text-slate-200">
                        Salary Component Details
                    </CardTitle>
                    <div className="relative w-72">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            placeholder="Search components..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 bg-white dark:bg-brand-green-darker shadow-sm"
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-brand-green-tint hover:bg-brand-green-tint dark:bg-sidebar-accent/80">
                                    <TableHead className="w-24 text-center font-bold">Salary Id</TableHead>
                                    <TableHead className="font-bold">Salary Name</TableHead>
                                    <TableHead className="text-center font-bold">Salary Type</TableHead>
                                    <TableHead className="text-center font-bold">Default %</TableHead>
                                    <TableHead className="w-32 text-center font-bold">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            <PageLoader fullScreen={false} />
                                        </TableCell>
                                    </TableRow>
                                ) : filteredComponents.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                                            No components found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredComponents.map((comp) => (
                                        <TableRow key={comp.id} className="hover:bg-green-50/50 dark:hover:bg-sidebar-accent/50 transition-colors">
                                            <TableCell className="text-center font-medium">{comp.salaryId}</TableCell>
                                            <TableCell>{comp.name}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={cn(
                                                    "px-2.5 py-0.5 rounded-full text-xs font-semibold",
                                                    comp.type === 'EARNINGS'
                                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                )}>
                                                    {comp.type}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center text-sm">
                                                {comp.defaultPercent !== null && comp.defaultPercent !== undefined
                                                    ? `${comp.defaultPercent}% of ${comp.percentBasis === 'GROSS' ? 'Gross' : 'Basic'}${comp.maxAmount !== null && comp.maxAmount !== undefined ? ` (max ₹${Number(comp.maxAmount).toLocaleString('en-IN')})` : ''}${comp.ctcEligibilityLimit !== null && comp.ctcEligibilityLimit !== undefined ? ` · CTC ≤ ₹${Number(comp.ctcEligibilityLimit).toLocaleString('en-IN')}` : ''}`
                                                    : <span className="text-slate-400">—</span>}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleEdit(comp)}
                                                        className="h-8 w-8 p-0 text-primary hover:bg-brand-green-tint dark:hover:bg-brand-green-darker/20"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleDelete(comp.id)}
                                                        className="h-8 w-8 p-0 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {filteredComponents.length > 0 && (
                        <div className="p-4 border-t text-sm text-slate-500 bg-green-50/30 dark:bg-brand-green-darker/20">
                            Showing {filteredComponents.length} of {components.length} components
                        </div>
                    )}
                </CardContent>
            </Card>
        </div >
    );
}
