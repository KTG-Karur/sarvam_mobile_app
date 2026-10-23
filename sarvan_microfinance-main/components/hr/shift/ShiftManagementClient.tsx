'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
import { Clock3, Pencil, Loader2, Save, Users, Trash2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { TimePickerField } from '@/components/ui/time-picker-field';

type Shift = {
    id: string;
    name: string;
    shiftStart: string;
    shiftEnd: string;
    fullDayHours: number;
    halfDayHours: number;
    graceMinutes: number;
    isDefault: boolean;
    isActive: boolean;
};

type BranchOption = { id: string; name: string; code: string };

type EmployeeRow = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    branch: { id: string; name: string; code: string } | null;
    shift: { id: string; name: string } | null;
};

function formatHhmm(hhmm: string): string {
    if (!hhmm) return '—';
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr);
    if (isNaN(h)) return hhmm;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mStr ?? '00'} ${period}`;
}

export function ShiftManagementClient() {
    const { toast } = useToast();

    // ── Shifts master ──
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [isLoadingShifts, setIsLoadingShifts] = useState(true);
    const [editingShift, setEditingShift] = useState<Shift | null>(null);
    const [shiftName, setShiftName] = useState('');
    const [shiftStart, setShiftStart] = useState('09:30');
    const [shiftEnd, setShiftEnd] = useState('18:00');
    const [shiftFullDayHours, setShiftFullDayHours] = useState('8');
    const [shiftHalfDayHours, setShiftHalfDayHours] = useState('4');
    const [shiftGraceMinutes, setShiftGraceMinutes] = useState('15');
    const [shiftIsDefault, setShiftIsDefault] = useState(false);
    const [shiftActive, setShiftActive] = useState(true);
    const [isSavingShift, setIsSavingShift] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; shift: Shift | null }>({ open: false, shift: null });
    const [isDeletingShift, setIsDeletingShift] = useState(false);

    const fetchShifts = useCallback(async () => {
        try {
            const res = await apiClient.get<Shift[]>('/hr/shifts?includeInactive=true');
            if (res.success && res.data) setShifts(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to load shifts.', variant: 'destructive' });
        } finally {
            setIsLoadingShifts(false);
        }
    }, [toast]);

    useEffect(() => { fetchShifts(); }, [fetchShifts]);

    const resetShiftForm = () => {
        setEditingShift(null);
        setShiftName('');
        setShiftStart('09:30');
        setShiftEnd('18:00');
        setShiftFullDayHours('8');
        setShiftHalfDayHours('4');
        setShiftGraceMinutes('15');
        setShiftIsDefault(false);
        setShiftActive(true);
    };

    const handleEditShift = (shift: Shift) => {
        setEditingShift(shift);
        setShiftName(shift.name);
        setShiftStart(shift.shiftStart);
        setShiftEnd(shift.shiftEnd);
        setShiftFullDayHours(String(shift.fullDayHours));
        setShiftHalfDayHours(String(shift.halfDayHours));
        setShiftGraceMinutes(String(shift.graceMinutes));
        setShiftIsDefault(shift.isDefault);
        setShiftActive(shift.isActive);
    };

    const handleSaveShift = async () => {
        if (!shiftName.trim()) {
            toast({ title: 'Error', description: 'Shift name is required.', variant: 'destructive' });
            return;
        }
        if (editingShift?.isDefault && !shiftIsDefault) {
            toast({ title: 'Error', description: 'At least one shift must stay the default — mark a different shift as default first.', variant: 'destructive' });
            return;
        }
        setIsSavingShift(true);
        try {
            const payload = {
                name: shiftName.trim(), shiftStart, shiftEnd,
                fullDayHours: Number(shiftFullDayHours) || 0,
                halfDayHours: Number(shiftHalfDayHours) || 0,
                graceMinutes: Math.round(Number(shiftGraceMinutes)) || 0,
                isDefault: shiftIsDefault,
                isActive: shiftActive,
            };
            const res = editingShift
                ? await apiClient.put<Shift>(`/hr/shifts?id=${editingShift.id}`, payload)
                : await apiClient.post<Shift>('/hr/shifts', payload);
            if (!res.success) throw new Error(res.error || 'Save failed');
            toast({ title: editingShift ? 'Shift Updated' : 'Shift Created', description: `"${shiftName.trim()}" saved.` });
            resetShiftForm();
            await fetchShifts();
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to save shift.', variant: 'destructive' });
        } finally {
            setIsSavingShift(false);
        }
    };

    const handleDeleteConfirm = async () => {
        const shift = deleteConfirmation.shift;
        if (!shift) return;
        setIsDeletingShift(true);
        try {
            const res = await apiClient.delete(`/hr/shifts?id=${shift.id}`);
            if (!res.success) throw new Error(res.error || 'Delete failed');
            toast({ title: 'Shift Disabled', description: `"${shift.name}" is now disabled.` });
            setDeleteConfirmation({ open: false, shift: null });
            if (editingShift?.id === shift.id) resetShiftForm();
            await fetchShifts();
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to delete shift.', variant: 'destructive' });
        } finally {
            setIsDeletingShift(false);
        }
    };

    const activeShifts = useMemo(() => shifts.filter((s) => s.isActive), [shifts]);

    // ── Assignment ──
    const [employees, setEmployees] = useState<EmployeeRow[]>([]);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [branchFilter, setBranchFilter] = useState<string>('all');
    const [shiftFilter, setShiftFilter] = useState<string>('all');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [roleOptions, setRoleOptions] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [assignShiftId, setAssignShiftId] = useState<string>('');
    const [isAssigning, setIsAssigning] = useState(false);

    const fetchEmployees = useCallback(async () => {
        try {
            const params = new URLSearchParams({ status: 'active' });
            if (branchFilter !== 'all') params.set('branchId', branchFilter);
            if (shiftFilter !== 'all') params.set('shiftId', shiftFilter);
            if (roleFilter !== 'all') params.set('role', roleFilter);
            const res = await apiClient.get<EmployeeRow[]>(`/hr/employees?${params.toString()}`);
            if (res.success && res.data) setEmployees(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to load employees.', variant: 'destructive' });
        } finally {
            setIsLoadingEmployees(false);
        }
    }, [toast, branchFilter, shiftFilter, roleFilter]);

    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

    useEffect(() => {
        apiClient.get<BranchOption[]>('/branches').then((res) => {
            if (res.success && res.data) setBranches(res.data);
        }).catch(() => { /* branch filter is optional */ });
    }, []);

    // Distinct roles across ALL active employees (unfiltered) — populated once, independent of
    // whichever role/branch/shift filters are currently narrowing the table below.
    useEffect(() => {
        apiClient.get<{ role: string }[]>('/hr/employees?status=active').then((res) => {
            if (res.success && res.data) {
                setRoleOptions(Array.from(new Set(res.data.map((e) => e.role))).sort());
            }
        }).catch(() => { /* role filter is optional */ });
    }, []);

    // Filters change which employees are visible — drop selections that scrolled out of view.
    useEffect(() => { setSelectedIds(new Set()); }, [branchFilter, shiftFilter, roleFilter]);

    const toggleOne = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const allVisibleSelected = employees.length > 0 && employees.every((e) => selectedIds.has(e.id));
    const toggleAllVisible = () => {
        setSelectedIds((prev) => {
            if (allVisibleSelected) return new Set();
            const next = new Set(prev);
            employees.forEach((e) => next.add(e.id));
            return next;
        });
    };

    const handleAssign = async () => {
        if (!assignShiftId || selectedIds.size === 0) return;
        setIsAssigning(true);
        try {
            const res = await apiClient.post<{ assignedCount: number; skippedCount: number }>('/hr/shifts/assign', {
                shiftId: assignShiftId,
                employeeIds: Array.from(selectedIds),
            });
            if (!res.success) throw new Error(res.error || 'Assignment failed');
            toast({ title: 'Assigned', description: res.message || `Assigned ${res.data?.assignedCount ?? 0} employee(s).` });
            setSelectedIds(new Set());
            await fetchEmployees();
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to assign shift.', variant: 'destructive' });
        } finally {
            setIsAssigning(false);
        }
    };

    if (isLoadingShifts) {
        return <PageLoader label="Loading Shift Management..." fullScreen={false} />;
    }

    return (
        <div className="mx-auto max-w-6xl space-y-6 py-4">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Clock3 className="h-6 w-6 text-primary" /> Shift Management
                </h1>
                <p className="text-sm text-slate-500">Define work shifts and assign employees to them.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{editingShift ? 'Edit Shift' : 'Add Shift'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label>Shift Name</Label>
                            <Input value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="e.g. Morning" />
                        </div>
                        <div className="space-y-2">
                            <Label>Start Time</Label>
                            <TimePickerField value={shiftStart} onChange={setShiftStart} minuteStep={5} />
                        </div>
                        <div className="space-y-2">
                            <Label>End Time</Label>
                            <TimePickerField value={shiftEnd} onChange={setShiftEnd} minuteStep={5} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label>Full Day Hours</Label>
                            <Input type="number" min={0} max={24} step="0.5" value={shiftFullDayHours} onChange={(e) => setShiftFullDayHours(e.target.value)} />
                            <p className="text-xs text-slate-500">Worked hours ≥ this = a full present day.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Half Day Hours</Label>
                            <Input type="number" min={0} max={24} step="0.5" value={shiftHalfDayHours} onChange={(e) => setShiftHalfDayHours(e.target.value)} />
                            <p className="text-xs text-slate-500">Below full-day hours but at/above this = half day.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Grace Minutes</Label>
                            <Input type="number" min={0} max={240} value={shiftGraceMinutes} onChange={(e) => setShiftGraceMinutes(e.target.value)} />
                            <p className="text-xs text-slate-500">Late-arrival grace after Start Time.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Switch checked={shiftActive} onCheckedChange={setShiftActive} />
                            <span className="text-sm">{shiftActive ? 'Active' : 'Disabled'}</span>
                        </div>
                        <label className="flex items-start gap-2 text-sm text-sidebar-accent dark:text-slate-300">
                            <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={shiftIsDefault}
                                onChange={(e) => setShiftIsDefault(e.target.checked)}
                            />
                            <span>
                                <strong>Default shift</strong> — used for any employee with no shift assigned. Only one
                                shift can be the default at a time.
                            </span>
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={handleSaveShift} disabled={isSavingShift || !shiftName.trim()}>
                            {isSavingShift ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editingShift ? 'Update Shift' : 'Add Shift'}
                        </Button>
                        {editingShift && (
                            <Button variant="outline" onClick={resetShiftForm}>Cancel</Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">Shifts</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Start</TableHead>
                                <TableHead>End</TableHead>
                                <TableHead>Full/Half Hrs</TableHead>
                                <TableHead>Grace</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-center">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {shifts.length === 0 ? (
                                <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">No shifts yet.</TableCell></TableRow>
                            ) : shifts.map((s) => (
                                <TableRow key={s.id}>
                                    <TableCell className="font-medium">
                                        {s.name}
                                        {s.isDefault && <Badge className="ml-2" variant="outline">Default</Badge>}
                                    </TableCell>
                                    <TableCell className="font-medium tabular-nums">{formatHhmm(s.shiftStart)}</TableCell>
                                    <TableCell className="font-medium tabular-nums">{formatHhmm(s.shiftEnd)}</TableCell>
                                    <TableCell className="text-sm text-slate-500">{s.fullDayHours}h / {s.halfDayHours}h</TableCell>
                                    <TableCell className="text-sm text-slate-500">{s.graceMinutes}m</TableCell>
                                    <TableCell>
                                        <Badge variant={s.isActive ? 'default' : 'outline'}>{s.isActive ? 'Active' : 'Disabled'}</Badge>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Button size="sm" variant="ghost" onClick={() => handleEditShift(s)}><Pencil className="h-4 w-4" /></Button>
                                        {s.isActive && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-red-600 hover:text-red-700"
                                                onClick={() => setDeleteConfirmation({ open: true, shift: s })}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Assign Employees</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Branch</Label>
                            <Select value={branchFilter} onValueChange={setBranchFilter}>
                                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Current Shift</Label>
                            <Select value={shiftFilter} onValueChange={setShiftFilter}>
                                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Any Shift</SelectItem>
                                    {activeShifts.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Role</Label>
                            <Select value={roleFilter} onValueChange={setRoleFilter}>
                                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Roles</SelectItem>
                                    {roleOptions.map((r) => (
                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="ml-auto flex items-end gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Assign to</Label>
                                <Select value={assignShiftId} onValueChange={setAssignShiftId}>
                                    <SelectTrigger className="w-48"><SelectValue placeholder="Select shift" /></SelectTrigger>
                                    <SelectContent>
                                        {activeShifts.map((s) => (
                                            <SelectItem key={s.id} value={s.id}>{s.name} ({s.shiftStart}-{s.shiftEnd})</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button onClick={handleAssign} disabled={isAssigning || !assignShiftId || selectedIds.size === 0}>
                                {isAssigning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Assign Selected ({selectedIds.size})
                            </Button>
                        </div>
                    </div>

                    {isLoadingEmployees ? (
                        <PageLoader label="Loading employees..." fullScreen={false} />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10">
                                        <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} />
                                    </TableHead>
                                    <TableHead>Employee</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Branch</TableHead>
                                    <TableHead>Current Shift</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">No employees match this filter.</TableCell></TableRow>
                                ) : employees.map((e) => (
                                    <TableRow key={e.id}>
                                        <TableCell>
                                            <Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleOne(e.id)} />
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {e.firstName} {e.lastName}
                                            <div className="text-xs text-slate-500">{e.employeeId}</div>
                                        </TableCell>
                                        <TableCell className="text-sm">{e.role}</TableCell>
                                        <TableCell className="text-sm">{e.branch ? `${e.branch.code} - ${e.branch.name}` : '—'}</TableCell>
                                        <TableCell className="text-sm">
                                            {e.shift ? <Badge variant="outline">{e.shift.name}</Badge> : <span className="text-slate-400">Unassigned</span>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) => setDeleteConfirmation({ open, shift: open ? deleteConfirmation.shift : null })}
                onConfirm={handleDeleteConfirm}
                title="Disable Shift"
                description={
                    deleteConfirmation.shift
                        ? `Are you sure you want to disable "${deleteConfirmation.shift.name}"? It will no longer be available for assignment. This is blocked if it is the default shift or if any employee is still assigned to it.`
                        : ''
                }
                confirmText="Disable"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeletingShift}
            />
        </div>
    );
}
