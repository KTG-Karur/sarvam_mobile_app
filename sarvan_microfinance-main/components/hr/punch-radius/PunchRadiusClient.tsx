'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Lock, LockOpen, MapPinOff, MapPinned, Search } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { usePermission } from '@/app/hooks/usePermission';
import { PageLoader } from '@/components/ui/page-loader';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

type EmployeeRow = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    punchRadiusLocked: boolean;
    branchHasLocation: boolean;
    branch: { id: string; name: string; code: string } | null;
    department: { id: string; name: string } | null;
    shift: { id: string; name: string; shiftStart: string; shiftEnd: string } | null;
};

type Option = { id: string; name: string; code?: string };

export function PunchRadiusClient() {
    const { toast } = useToast();
    const { canPage } = usePermission();
    const canEdit = canPage('/dashboard/hr/punch-radius', 'edit');

    const [employees, setEmployees] = useState<EmployeeRow[]>([]);
    const [branches, setBranches] = useState<Option[]>([]);
    const [departments, setDepartments] = useState<Option[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [branchFilter, setBranchFilter] = useState('all');
    const [departmentFilter, setDepartmentFilter] = useState('all');
    const [lockFilter, setLockFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [pendingBulk, setPendingBulk] = useState<boolean | null>(null);
    const [isApplying, setIsApplying] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        apiClient.get<Option[]>('/branches?permitted=true').then((res) => {
            if (res.success && res.data) setBranches(res.data);
        });
        apiClient.get<Option[]>('/hr/departments').then((res) => {
            if (res.success && res.data) setDepartments(res.data);
        });
    }, []);

    const fetchEmployees = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            params.set('branchId', branchFilter);
            if (departmentFilter !== 'all') params.set('departmentId', departmentFilter);
            if (lockFilter !== 'all') params.set('locked', lockFilter);
            if (debouncedSearch) params.set('search', debouncedSearch);
            const res = await apiClient.get<EmployeeRow[]>(`/hr/punch-radius?${params.toString()}`);
            if (res.success && res.data) setEmployees(res.data);
            else toast({ title: 'Error', description: res.error || 'Failed to load employees.', variant: 'destructive' });
        } catch {
            toast({ title: 'Error', description: 'Failed to load employees.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast, branchFilter, departmentFilter, lockFilter, debouncedSearch]);

    useEffect(() => { void fetchEmployees(); }, [fetchEmployees]);

    // Filters change which employees are visible — drop selections that scrolled out of view.
    useEffect(() => { setSelectedIds(new Set()); }, [branchFilter, departmentFilter, lockFilter, debouncedSearch]);

    const lockedCount = useMemo(() => employees.filter((e) => e.punchRadiusLocked).length, [employees]);
    const allVisibleSelected = employees.length > 0 && employees.every((e) => selectedIds.has(e.id));

    const toggleOne = (id: string) =>
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const toggleAllVisible = () =>
        setSelectedIds(allVisibleSelected ? new Set() : new Set(employees.map((e) => e.id)));

    const apply = async (employeeIds: string[], locked: boolean) => {
        const res = await apiClient.post<{ changedCount: number; unchangedCount: number; skippedCount: number }>(
            '/hr/punch-radius/assign',
            { employeeIds, locked },
        );
        if (!res.success) throw new Error(res.error || 'Update failed');
        return res;
    };

    const handleRowToggle = async (employee: EmployeeRow, locked: boolean) => {
        setTogglingId(employee.id);
        try {
            await apply([employee.id], locked);
            setEmployees((prev) => prev.map((e) => (e.id === employee.id ? { ...e, punchRadiusLocked: locked } : e)));
            toast({
                title: locked ? 'Locked' : 'Unlocked',
                description: `${employee.firstName} ${employee.lastName} ${locked ? 'can now punch in only near the branch.' : 'can punch in from anywhere.'}`,
            });
        } catch (error: unknown) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : 'Update failed.', variant: 'destructive' });
        } finally {
            setTogglingId(null);
        }
    };

    const handleBulkConfirm = async () => {
        if (pendingBulk === null || selectedIds.size === 0) return;
        setIsApplying(true);
        try {
            const res = await apply(Array.from(selectedIds), pendingBulk);
            toast({ title: pendingBulk ? 'Locked' : 'Unlocked', description: res.message || 'Updated.' });
            setSelectedIds(new Set());
            setPendingBulk(null);
            await fetchEmployees();
        } catch (error: unknown) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : 'Update failed.', variant: 'destructive' });
        } finally {
            setIsApplying(false);
        }
    };

    if (isLoading) return <PageLoader label="Loading employees..." fullScreen={false} />;

    return (
        <>
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="flex items-center justify-between text-lg font-semibold text-white">
                        <span className="flex items-center gap-2"><MapPinned className="h-5 w-5" /> Employees</span>
                        <Badge variant="outline" className="border-white/40 text-white">
                            {lockedCount} locked / {employees.length}
                        </Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 p-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <div className="space-y-1">
                            <Label>Branch</Label>
                            <Select value={branchFilter} onValueChange={setBranchFilter}>
                                <SelectTrigger className="bg-white"><SelectValue placeholder="All Branches" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code ? `${b.code} - ` : ''}{b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Department</Label>
                            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                                <SelectTrigger className="bg-white"><SelectValue placeholder="All Departments" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Departments</SelectItem>
                                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Radius lock</Label>
                            <Select value={lockFilter} onValueChange={setLockFilter}>
                                <SelectTrigger className="bg-white"><SelectValue placeholder="All" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="true">Locked</SelectItem>
                                    <SelectItem value="false">Unlocked</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Search</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Name or employee ID"
                                    className="bg-white pl-9"
                                />
                            </div>
                        </div>
                    </div>

                    {canEdit && (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-green-50/60 px-4 py-3 dark:bg-brand-green-darker/30">
                            <span className="text-sm font-medium">{selectedIds.size} selected</span>
                            <Button size="sm" disabled={selectedIds.size === 0 || isApplying} onClick={() => setPendingBulk(true)} className="gap-2">
                                <Lock className="h-4 w-4" /> Lock selected
                            </Button>
                            <Button size="sm" variant="outline" disabled={selectedIds.size === 0 || isApplying} onClick={() => setPendingBulk(false)} className="gap-2">
                                <LockOpen className="h-4 w-4" /> Unlock selected
                            </Button>
                        </div>
                    )}

                    <div className="overflow-x-auto rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-primary hover:bg-primary">
                                    {canEdit && (
                                        <TableHead className="w-10">
                                            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Select all" />
                                        </TableHead>
                                    )}
                                    <TableHead className="font-semibold text-white">Employee</TableHead>
                                    <TableHead className="font-semibold text-white">Branch</TableHead>
                                    <TableHead className="font-semibold text-white">Department</TableHead>
                                    <TableHead className="font-semibold text-white">Shift</TableHead>
                                    <TableHead className="text-center font-semibold text-white">Radius lock</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={canEdit ? 6 : 5} className="py-8 text-center text-slate-500">
                                            No employees match the selected filters.
                                        </TableCell>
                                    </TableRow>
                                ) : employees.map((e, index) => (
                                    <TableRow key={e.id} className={index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50 dark:bg-sidebar-accent'}>
                                        {canEdit && (
                                            <TableCell>
                                                <Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleOne(e.id)} aria-label={`Select ${e.firstName}`} />
                                            </TableCell>
                                        )}
                                        <TableCell className="font-medium">
                                            {e.employeeId ? `${e.employeeId} - ` : ''}{e.firstName} {e.lastName}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {e.branch ? `${e.branch.code} - ${e.branch.name}` : '—'}
                                            {e.branch && !e.branchHasLocation && (
                                                <Badge variant="outline" className="ml-2 gap-1 border-amber-300 text-[10px] text-amber-700" title="This branch has no latitude/longitude, so the radius rule is skipped for its employees.">
                                                    <MapPinOff className="h-3 w-3" /> No branch location
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">{e.department?.name ?? '—'}</TableCell>
                                        <TableCell className="text-sm">{e.shift?.name ?? 'Default'}</TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <Switch
                                                    checked={e.punchRadiusLocked}
                                                    disabled={!canEdit || togglingId === e.id}
                                                    onCheckedChange={(checked) => void handleRowToggle(e, checked)}
                                                    aria-label={`Radius lock for ${e.firstName}`}
                                                />
                                                <span className={e.punchRadiusLocked ? 'text-xs font-medium text-green-700' : 'text-xs text-slate-500'}>
                                                    {e.punchRadiusLocked ? 'Locked' : 'Unlocked'}
                                                </span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <ConfirmationDialog
                open={pendingBulk !== null}
                onOpenChange={(open) => { if (!open && !isApplying) setPendingBulk(null); }}
                title={pendingBulk ? 'Lock punch-in radius?' : 'Unlock punch-in radius?'}
                description={
                    pendingBulk
                        ? `${selectedIds.size} employee(s) will be able to punch in only within about 100 m of their branch.`
                        : `${selectedIds.size} employee(s) will be able to punch in from any location.`
                }
                confirmText={pendingBulk ? 'Lock' : 'Unlock'}
                onConfirm={() => void handleBulkConfirm()}
                isLoading={isApplying}
            />
        </>
    );
}
