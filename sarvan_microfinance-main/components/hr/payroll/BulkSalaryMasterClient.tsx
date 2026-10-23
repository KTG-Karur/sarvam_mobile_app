'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, Save, Users } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';

type BranchOption = { id: string; name: string; code: string };
type BulkRow = {
    employeeId: string;
    employeeName: string;
    employeeCode: string | null;
    branchName: string | null;
    designationName: string | null;
    basicPercent: number;
    hraPercent: number;
    monthlyCtc: number;
    yearCtc: number;
    basic: number;
    hra: number;
    percentDeductions: { name: string; amount: number }[];
};

const formatCurrency = (value: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value);

export function BulkSalaryMasterClient() {
    const { toast } = useToast();

    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(true);
    const [branchId, setBranchId] = useState('all');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [rows, setRows] = useState<BulkRow[]>([]);
    const [ctcEdits, setCtcEdits] = useState<Record<string, string>>({});

    useEffect(() => {
        setIsLoadingBranches(true);
        apiClient.get<BranchOption[]>('/branches?permitted=true')
            .then((res) => {
                if (res.success && res.data) setBranches(res.data.map((b) => ({ id: b.id, name: b.name, code: b.code })));
            })
            .catch(() => toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' }))
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLoad = async () => {
        setIsLoading(true);
        setRows([]);
        setCtcEdits({});
        try {
            const res = await apiClient.get<{ total: number; rows: BulkRow[] }>(`/payroll/salary-master/bulk?branchId=${branchId}`);
            if (res.success && res.data) {
                setRows(res.data.rows);
                setCtcEdits(Object.fromEntries(res.data.rows.map((r) => [r.employeeId, String(r.monthlyCtc || '')])));
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load employees.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const changedCount = useMemo(
        () => rows.filter((r) => Number(ctcEdits[r.employeeId] || 0) !== r.monthlyCtc).length,
        [rows, ctcEdits]
    );

    const handleSaveAll = async () => {
        const updates = rows
            .filter((r) => Number(ctcEdits[r.employeeId] || 0) !== r.monthlyCtc)
            .map((r) => ({ employeeId: r.employeeId, monthlyCtc: Number(ctcEdits[r.employeeId] || 0) }));
        if (updates.length === 0) {
            toast({ title: 'Nothing to save', description: 'No Month CTC Pay values were changed.' });
            return;
        }
        setIsSaving(true);
        try {
            const res = await apiClient.post<{ saved: number; failed: number }>('/payroll/salary-master/bulk', { updates });
            if (res.success && res.data) {
                toast({
                    title: 'Saved',
                    description: `${res.data.saved} employee(s) saved${res.data.failed ? `, ${res.data.failed} failed` : ''}.`,
                    className: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
                });
                handleLoad();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                        <Users className="h-5 w-5" /> Bulk Salary Master — CTC
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Set Month CTC Pay for every employee in scope at once. Basic/HRA % come from each employee's
                        Designation (set on Designation Master); PF/ESI % come from Salary Details — both shown here
                        read-only, computed live from CTC.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Branch</Label>
                            <Select value={branchId} onValueChange={setBranchId} disabled={isLoadingBranches}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue placeholder="All Branches" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <Button onClick={handleLoad} disabled={isLoading} size="lg" variant="outline" className="border-primary/30 text-primary min-w-[200px]">
                        {isLoading ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Search className="h-5 w-5 mr-2" />}
                        {isLoading ? 'Loading...' : 'Load Details'}
                    </Button>
                </CardContent>
            </Card>

            {rows.length > 0 && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex flex-wrap items-center justify-between gap-2">
                            <span>{rows.length} Employee{rows.length === 1 ? '' : 's'}</span>
                            {changedCount > 0 && <span className="text-sm font-normal">{changedCount} changed</span>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Employee</TableHead>
                                        <TableHead>Branch</TableHead>
                                        <TableHead>Designation</TableHead>
                                        <TableHead className="text-right w-40">Month CTC Pay</TableHead>
                                        <TableHead className="text-right">Year CTC</TableHead>
                                        <TableHead className="text-right">Basic ({rows[0]?.basicPercent ?? 70}%)</TableHead>
                                        <TableHead className="text-right">HRA</TableHead>
                                        {rows[0]?.percentDeductions.map((pd) => (
                                            <TableHead key={pd.name} className="text-right">{pd.name}</TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((r) => {
                                        const editedCtc = Number(ctcEdits[r.employeeId] || 0);
                                        const preview = editedCtc !== r.monthlyCtc;
                                        return (
                                            <TableRow key={r.employeeId}>
                                                <TableCell className="text-sm">
                                                    {r.employeeName}
                                                    <p className="text-xs text-slate-400">{r.employeeCode ?? '—'}</p>
                                                </TableCell>
                                                <TableCell className="text-sm">{r.branchName ?? '—'}</TableCell>
                                                <TableCell className="text-sm">{r.designationName ?? '—'}</TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={ctcEdits[r.employeeId] ?? ''}
                                                        onChange={(e) => setCtcEdits((prev) => ({ ...prev, [r.employeeId]: e.target.value }))}
                                                        className={preview ? 'text-right font-semibold border-amber-400 dark:border-amber-500' : 'text-right'}
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right text-sm">{formatCurrency(editedCtc * 12)}</TableCell>
                                                <TableCell className="text-right text-sm">{formatCurrency(preview ? Math.round(editedCtc * r.basicPercent / 100) : r.basic)}</TableCell>
                                                <TableCell className="text-right text-sm">{formatCurrency(preview ? Math.round(editedCtc * r.hraPercent / 100) : r.hra)}</TableCell>
                                                {r.percentDeductions.map((pd) => (
                                                    <TableCell key={pd.name} className="text-right text-sm text-slate-500">{formatCurrency(pd.amount)}</TableCell>
                                                ))}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="p-4 border-t border-primary/10 dark:border-sidebar-accent flex justify-end">
                            <Button
                                onClick={handleSaveAll}
                                disabled={isSaving || changedCount === 0}
                                size="lg"
                                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg min-w-[200px]"
                            >
                                {isSaving ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Save className="h-5 w-5 mr-2" />}
                                {isSaving ? 'Saving...' : `Save All${changedCount ? ` (${changedCount})` : ''}`}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
