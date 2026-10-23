'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Clock, Plus, XCircle, Users, UserCheck } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { TimePickerField } from '@/components/ui/time-picker-field';
import { usePermission } from '@/app/hooks/usePermission';
import { toDisplayDate } from '@/app/lib/date-format';

type PermissionTypeOption = { id: string; permissionType: string; typeId: number };

type EmployeeOption = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    branch?: { id: string; name: string; code: string } | null;
};

type PermissionRequest = {
    id: string;
    date: string;
    fromTime: string;
    toTime: string;
    hours: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    reason: string | null;
    approvalRemarks: string | null;
    permissionType: { permissionType: string };
    approvedBy: { firstName: string; lastName: string } | null;
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED' || status === 'CANCELLED') return 'destructive';
    return 'outline';
}

export function PermissionApplicationClient() {
    const { toast } = useToast();
    const { canPage } = usePermission();

    // Dynamic permission from Role Permissions Editor (no hardcoded roles)
    const canApplyForOthers =
        canPage('/dashboard/hr/permission/apply', 'edit') ||
        canPage('/dashboard/hr/permission/approval', 'approve');

    const [requests, setRequests] = useState<PermissionRequest[]>([]);
    const [permissionTypes, setPermissionTypes] = useState<PermissionTypeOption[]>([]);
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Modal state
    const [isApplyOpen, setIsApplyOpen] = useState(false);
    const [applyFor, setApplyFor] = useState<'SELF' | 'OTHER'>('SELF');
    const [selectedModalBranch, setSelectedModalBranch] = useState<string>('ALL');
    const [targetEmployeeId, setTargetEmployeeId] = useState<string>('');

    const uniqueBranches = useMemo(() => {
        const map = new Map<string, { id: string; name: string; code: string }>();
        employees.forEach((emp) => {
            if (emp.branch?.id) {
                map.set(emp.branch.id, emp.branch);
            }
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        if (!selectedModalBranch || selectedModalBranch === 'ALL') return employees;
        return employees.filter((emp) => emp.branch?.id === selectedModalBranch);
    }, [employees, selectedModalBranch]);

    const [permissionTypeId, setPermissionTypeId] = useState('');
    const [date, setDate] = useState('');
    const [fromTime, setFromTime] = useState('');
    const [toTime, setToTime] = useState('');
    const [reason, setReason] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const apiCalls: Promise<any>[] = [
                apiClient.get<PermissionRequest[]>('/hr/permission'),
                apiClient.get<PermissionTypeOption[]>('/payroll/permission-types'),
            ];

            if (canApplyForOthers) {
                apiCalls.push(apiClient.get<EmployeeOption[]>('/hr/employees?status=active'));
            }

            const [reqRes, typesRes, empsRes] = await Promise.all(apiCalls);

            if (reqRes.success && reqRes.data) setRequests(reqRes.data);
            if (typesRes.success && typesRes.data) setPermissionTypes(typesRes.data);
            if (empsRes?.success && empsRes.data) setEmployees(empsRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch permission data.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [canApplyForOthers, toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleApply = async () => {
        try {
            const payload: any = {
                permissionTypeId,
                date,
                fromTime,
                toTime,
                reason: reason || null,
            };

            if (applyFor === 'OTHER' && targetEmployeeId) {
                payload.employeeId = targetEmployeeId;
            }

            const res = await apiClient.post('/hr/permission/apply', payload);
            if (res.success) {
                toast({ title: 'Submitted', description: 'Permission request submitted successfully.' });
                setIsApplyOpen(false);
                setPermissionTypeId(''); setDate(''); setFromTime(''); setToTime(''); setReason('');
                setApplyFor('SELF'); setTargetEmployeeId('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Submission failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Submission failed.', variant: 'destructive' });
        }
    };

    const handleCancel = async (row: PermissionRequest) => {
        try {
            const res = await apiClient.post(`/hr/permission/${row.id}/cancel`);
            if (res.success) {
                toast({ title: 'Cancelled', description: 'Permission request cancelled.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Cancellation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Cancellation failed.', variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Permission..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Clock className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">My Permission</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Apply, track and cancel your short permission (gate-pass) requests.</p>
                        </div>
                    </div>
                    <Button onClick={() => setIsApplyOpen(true)} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Apply for Permission
                    </Button>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Permission Type</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Hours</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {requests.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                                No permission requests yet.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        requests.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="text-sm">{row.permissionType.permissionType}</TableCell>
                                                <TableCell className="text-sm">{toDisplayDate(new Date(row.date))}</TableCell>
                                                <TableCell className="text-sm">{row.fromTime} — {row.toTime}</TableCell>
                                                <TableCell className="text-sm">{row.hours}</TableCell>
                                                <TableCell><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
                                                <TableCell className="text-center">
                                                    {row.status === 'PENDING' && (
                                                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleCancel(row)} title="Cancel">
                                                            <XCircle className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={isApplyOpen} onOpenChange={setIsApplyOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Apply for Permission</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {canApplyForOthers && (
                            <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/30">
                                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Apply For</Label>
                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={applyFor === 'SELF' ? 'default' : 'outline'}
                                        onClick={() => { setApplyFor('SELF'); setTargetEmployeeId(''); }}
                                        className="text-xs"
                                    >
                                        <UserCheck className="h-3.5 w-3.5 mr-1" /> Myself
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={applyFor === 'OTHER' ? 'default' : 'outline'}
                                        onClick={() => setApplyFor('OTHER')}
                                        className="text-xs"
                                    >
                                        <Users className="h-3.5 w-3.5 mr-1" /> Other Employee
                                    </Button>
                                </div>

                                {applyFor === 'OTHER' && (
                                    <div className="mt-3 space-y-3">
                                        {uniqueBranches.length > 0 && (
                                            <div className="space-y-1.5">
                                                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                    Filter by Branch
                                                </Label>
                                                <Select
                                                    value={selectedModalBranch}
                                                    onValueChange={(val) => {
                                                        setSelectedModalBranch(val);
                                                        setTargetEmployeeId('');
                                                    }}
                                                >
                                                    <SelectTrigger className="h-9 text-xs">
                                                        <SelectValue placeholder="All Branches" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="ALL">All Branches ({employees.length} employees)</SelectItem>
                                                        {uniqueBranches.map((b) => (
                                                            <SelectItem key={b.id} value={b.id}>
                                                                {b.name} ({b.code})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}

                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Select Employee <span className="text-red-500">*</span>
                                            </Label>
                                            <Select value={targetEmployeeId} onValueChange={setTargetEmployeeId}>
                                                <SelectTrigger className="h-9 text-xs">
                                                    <SelectValue placeholder={filteredEmployees.length === 0 ? 'No employees in selected branch' : 'Search or select employee'} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {filteredEmployees.map((emp) => (
                                                        <SelectItem key={emp.id} value={emp.id}>
                                                            {emp.firstName} {emp.lastName} {emp.employeeId ? `(${emp.employeeId})` : ''} {emp.branch ? `— ${emp.branch.name}` : ''}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Permission Type</Label>
                            <Select value={permissionTypeId} onValueChange={setPermissionTypeId}>
                                <SelectTrigger><SelectValue placeholder="Select permission type" /></SelectTrigger>
                                <SelectContent>
                                    {permissionTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.permissionType}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <DatePickerField value={date} onChange={setDate} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>From Time</Label>
                                <TimePickerField value={fromTime} onChange={setFromTime} minuteStep={5} />
                            </div>
                            <div className="space-y-2">
                                <Label>To Time</Label>
                                <TimePickerField value={toTime} onChange={setToTime} minuteStep={5} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Reason (optional)</Label>
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Provide reason for permission" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsApplyOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleApply}
                            disabled={!permissionTypeId || !date || !fromTime || !toTime || (applyFor === 'OTHER' && !targetEmployeeId)}
                        >
                            Submit
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
