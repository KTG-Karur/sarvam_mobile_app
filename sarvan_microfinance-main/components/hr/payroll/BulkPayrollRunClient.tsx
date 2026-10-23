'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { PayrollGrid } from './PayrollGrid';
import { setGridEdit, isGridEditEmpty, type GridEdits, type GridEditKey } from '@/app/lib/payroll/payroll-grid';
import type { BulkGridPreview, BulkGridRow, BulkRunRowInput } from '@/app/lib/payroll/bulk-grid-types';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Play, Users, CheckCircle2, XCircle, MinusCircle, Search } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';

type BranchOption = { id: string; name: string; code: string };
type RunResult = { employeeId: string; employeeName: string; status: 'paid' | 'skipped' | 'failed'; reason?: string };
type RunSummary = { total: number; paid: number; skipped: number; failed: number; results: RunResult[] };

const MONTH_OPTIONS = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
    { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
    { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
    { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
];
const PAYMENT_TYPES = ['Bank Transfer', 'Cash', 'Cheque'];
const CURRENT_CALENDAR_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => String(CURRENT_CALENDAR_YEAR - 2 + i));

const RUN_STATUS_ICON: Record<RunResult['status'], typeof CheckCircle2> = { paid: CheckCircle2, skipped: MinusCircle, failed: XCircle };
const RUN_STATUS_CLASS: Record<RunResult['status'], string> = {
    paid: 'text-green-600 dark:text-green-400', skipped: 'text-slate-400', failed: 'text-red-600 dark:text-red-400',
};

export function BulkPayrollRunClient() {
    const { toast } = useToast();

    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(true);
    const [branchId, setBranchId] = useState<string>('all');
    const [month, setMonth] = useState<string>('all');
    const [year, setYear] = useState<string>(String(CURRENT_CALENDAR_YEAR));
    const [paymentType, setPaymentType] = useState<string>('all');

    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [preview, setPreview] = useState<BulkGridPreview | null>(null);
    // Grid state: only the cells the user actually edited (sparse), and which
    // employees a Run will pay. The server recomputes everything from these edits.
    const [edits, setEdits] = useState<Record<string, GridEdits>>({});
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const rowsById = useRef(new Map<string, BulkGridRow>());
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [runSummary, setRunSummary] = useState<RunSummary | null>(null);

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

    const selectedBranchLabel = branchId === 'all'
        ? 'All Branches'
        : branches.find((b) => b.id === branchId)?.name ?? branchId;
    const monthLabel = MONTH_OPTIONS.find((m) => m.value === month)?.label ?? '';
    const canLoad = branchId && month !== 'all';

    const handleLoad = async () => {
        if (!canLoad) return;
        setIsLoadingPreview(true);
        setPreview(null);
        setRunSummary(null);
        try {
            const res = await apiClient.post<BulkGridPreview>('/payroll/salary-pay/bulk-run/preview', {
                branchId, month: parseInt(month), year: parseInt(year),
            });
            if (res.success && res.data) {
                rowsById.current = new Map(res.data.rows.map((r) => [r.employeeId, r]));
                setEdits({});
                setSelected(new Set(res.data.rows.filter((r) => r.willRun).map((r) => r.employeeId)));
                setPreview(res.data);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load preview.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsLoadingPreview(false);
        }
    };

    const handleEdit = useCallback((employeeId: string, key: GridEditKey | 'workingDays', value: number | null) => {
        setEdits((prev) => {
            const current = prev[employeeId] ?? {};
            let editKey: GridEditKey;
            let editValue = value;
            if (key === 'workingDays') {
                // Working days = Total Paid Days - LOP: editing it edits LOP.
                const paidDays = current.totalPaidDays ?? rowsById.current.get(employeeId)?.base?.totalPaidDays ?? 30;
                editKey = 'lopDays';
                editValue = value === null ? null : Math.max(0, paidDays - value);
            } else {
                editKey = key;
            }
            const next = setGridEdit(current, editKey, editValue);
            const out = { ...prev };
            if (isGridEditEmpty(next)) delete out[employeeId];
            else out[employeeId] = next;
            return out;
        });
    }, []);

    const handleResetRow = useCallback((employeeId: string) => {
        setEdits((prev) => {
            const out = { ...prev };
            delete out[employeeId];
            return out;
        });
    }, []);

    const handleToggleRow = useCallback((employeeId: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(employeeId);
            else next.delete(employeeId);
            return next;
        });
    }, []);

    const handleToggleAll = useCallback((checked: boolean) => {
        setSelected(checked ? new Set(Array.from(rowsById.current.values()).filter((r) => r.willRun).map((r) => r.employeeId)) : new Set());
    }, []);

    const runnableSelectedCount = useMemo(
        () => (preview ? preview.rows.filter((r) => r.willRun && selected.has(r.employeeId)).length : 0),
        [preview, selected],
    );
    const editedRowCount = Object.keys(edits).length;

    const handleRun = async () => {
        setIsConfirmOpen(false);
        setIsRunning(true);
        try {
            const rows: BulkRunRowInput[] = (preview?.rows ?? [])
                .filter((r) => r.willRun && selected.has(r.employeeId))
                .map((r) => ({ employeeId: r.employeeId, edits: edits[r.employeeId] ?? {} }));
            const res = await apiClient.post<RunSummary>('/payroll/salary-pay/bulk-run', {
                branchId, month: parseInt(month), year: parseInt(year), paymentType, rows,
            });
            if (res.success && res.data) {
                setRunSummary(res.data);
                toast({
                    title: 'Bulk Payroll Run Complete',
                    description: `${res.data.paid} paid, ${res.data.skipped} skipped, ${res.data.failed} failed.`,
                    className: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
                });
                handleLoad(); // refresh the preview to reflect the new PAID statuses
            } else {
                toast({ title: 'Error', description: res.error || 'Bulk payroll run failed.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                        <Users className="h-5 w-5" /> Bulk Payroll Run
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Load the details for every active employee in scope first. The grid mirrors the Payroll excel sheet —
                        Days, LOP and CTC come from attendance and Salary Master, and every cell can be edited (totals, PF/ESI
                        and Net Pay recalculate live). Untick anyone you don't want paid — then Run. Running goes straight to <strong>Paid</strong> for everyone still
                        eligible (staff loan recoveries are posted immediately too). Use the Individual tab for one-off corrections.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Month</Label>
                            <Select value={month} onValueChange={setMonth}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- SELECT --</SelectItem>
                                    {MONTH_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Year</Label>
                            <Select value={year} onValueChange={setYear}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Payment Type</Label>
                            <Select value={paymentType} onValueChange={setPaymentType}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- SELECT --</SelectItem>
                                    {PAYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <Button
                        onClick={handleLoad}
                        disabled={!canLoad || isLoadingPreview}
                        size="lg"
                        variant="outline"
                        className="border-primary/30 text-primary min-w-[200px]"
                    >
                        {isLoadingPreview ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Search className="h-5 w-5 mr-2" />}
                        {isLoadingPreview ? 'Loading...' : 'Load Details'}
                    </Button>
                    {isLoadingPreview && (
                        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                            Calculating attendance, CTC and incentives for {branchId === 'all' ? 'every employee in all your branches' : 'this branch'}
                            {branchId === 'all' ? ' — this can take around 10–15 seconds.' : '.'}
                        </p>
                    )}
                </CardContent>
            </Card>

            {preview && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex flex-wrap items-center justify-between gap-2">
                            <span>{monthLabel} {year} — {selectedBranchLabel}</span>
                            <span className="text-sm font-normal">
                                {preview.willRunCount} ready · {preview.blockedCount} blocked (of {preview.total})
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <PayrollGrid
                            rows={preview.rows}
                            edits={edits}
                            selected={selected}
                            disabled={isRunning}
                            onEdit={handleEdit}
                            onResetRow={handleResetRow}
                            onToggleRow={handleToggleRow}
                            onToggleAll={handleToggleAll}
                        />
                        <div className="p-4 border-t border-primary/10 dark:border-sidebar-accent flex justify-end">
                            <Button
                                onClick={() => setIsConfirmOpen(true)}
                                disabled={paymentType === 'all' || runnableSelectedCount === 0 || isRunning}
                                size="lg"
                                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg min-w-[220px]"
                            >
                                {isRunning ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Play className="h-5 w-5 mr-2" />}
                                {isRunning ? 'Running Payroll...' : `Run Payroll for ${runnableSelectedCount} Employee${runnableSelectedCount === 1 ? '' : 's'}`}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {runSummary && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center justify-between">
                            <span>Run Result</span>
                            <span className="text-sm font-normal">
                                {runSummary.paid} paid · {runSummary.skipped} skipped · {runSummary.failed} failed (of {runSummary.total})
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Employee</TableHead>
                                        <TableHead className="w-32 text-center">Status</TableHead>
                                        <TableHead>Reason</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {runSummary.results.map((r) => {
                                        const Icon = RUN_STATUS_ICON[r.status];
                                        return (
                                            <TableRow key={r.employeeId}>
                                                <TableCell className="text-sm">{r.employeeName}</TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="outline" className={RUN_STATUS_CLASS[r.status]}>
                                                        <Icon className="h-3.5 w-3.5 mr-1" />{r.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500">{r.reason ?? '—'}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <ConfirmationDialog
                open={isConfirmOpen}
                onOpenChange={setIsConfirmOpen}
                onConfirm={handleRun}
                title="Run Bulk Payroll?"
                description={`This will mark PAID ${runnableSelectedCount} employee(s) in ${selectedBranchLabel} for ${monthLabel} ${year} (Payment Type: ${paymentType})${editedRowCount > 0 ? `, using your manual edits on ${editedRowCount} row(s)` : ''} — including posting any staff loan salary recoveries immediately. This cannot be undone. Continue?`}
                confirmText="Run Payroll"
                cancelText="Cancel"
                type="warning"
                isLoading={isRunning}
            />
        </div>
    );
}
