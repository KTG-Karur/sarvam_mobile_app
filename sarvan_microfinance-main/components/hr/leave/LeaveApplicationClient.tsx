'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { CalendarRange, Plus, XCircle, Users, UserCheck, AlertTriangle, Paperclip } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { usePermission } from '@/app/hooks/usePermission';
import { compressImageForCategory } from '@/app/lib/image-compress';
import { toDisplayDate } from '@/app/lib/date-format';

type LeaveTypeOption = { id: string; leaveType: string; typeId: number; isLop?: boolean; attachmentRequiredAboveDays?: number | string | null };
type ProofFile = { fileKey: string; fileName: string; fileSize: number };
const PROOF_MAX_FILES = 3;
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
type LeaveBalance = { id: string; leaveType: string; openingBalance: number; carriedForwardDays?: number; allowCarryForward?: boolean; used: number; remainingBalance: number };

type EmployeeOption = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    branch?: { id: string; name: string; code: string } | null;
};

type LeaveApplication = {
    id: string;
    fromDate: string;
    toDate: string;
    numberOfDays: number;
    isHalfDay?: boolean;
    attachments?: { id: string; fileName: string; mimeType: string; fileSize: number }[];
    halfDaySession?: 'FIRST_HALF' | 'SECOND_HALF' | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    reason: string | null;
    approvalRemarks: string | null;
    leaveType: { leaveType: string };
    approvedBy: { firstName: string; lastName: string } | null;
    /** Balance-aware warning fields — see GET /api/hr/leave. */
    remainingBalance?: number;
    excessDaysIfApproved?: number;
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED' || status === 'CANCELLED') return 'destructive';
    return 'outline';
}

function formatDays(days: number | string | undefined | null): string {
    const n = Number(days) || 0;
    return n % 1 === 0 ? n.toString() : n.toFixed(1);
}

function calendarDaysBetween(from: string, to: string): number {
    if (!from || !to) return 0;
    const f = new Date(`${from}T00:00:00Z`).getTime();
    const t = new Date(`${to}T00:00:00Z`).getTime();
    if (isNaN(f) || isNaN(t) || t < f) return 0;
    return Math.round((t - f) / (24 * 60 * 60 * 1000)) + 1;
}

export function LeaveApplicationClient() {
    const { toast } = useToast();
    const { canPage } = usePermission();

    // Dynamic permission from Role Permissions Editor (no hardcoded roles)
    const canApplyForOthers =
        canPage('/dashboard/hr/leave/apply', 'edit') ||
        canPage('/dashboard/hr/leave/approval', 'approve');

    const [applications, setApplications] = useState<LeaveApplication[]>([]);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Modal state
    const [isApplyOpen, setIsApplyOpen] = useState(false);
    const [applyFor, setApplyFor] = useState<'SELF' | 'OTHER'>('SELF');
    const [selectedModalBranch, setSelectedModalBranch] = useState<string>('ALL');
    const [targetEmployeeId, setTargetEmployeeId] = useState<string>('');
    const [targetBalances, setTargetBalances] = useState<LeaveBalance[]>([]);
    const [loadingTargetBalances, setLoadingTargetBalances] = useState(false);

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

    const [leaveTypeId, setLeaveTypeId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [reason, setReason] = useState('');
    const [isHalfDay, setIsHalfDay] = useState(false);
    const [halfDaySession, setHalfDaySession] = useState<'FIRST_HALF' | 'SECOND_HALF'>('FIRST_HALF');
    const [proofFiles, setProofFiles] = useState<ProofFile[]>([]);
    const [isUploadingProof, setIsUploadingProof] = useState(false);

    // Uploaded proof belongs to whoever the leave is for - drop it if that changes.
    useEffect(() => { setProofFiles([]); }, [applyFor, targetEmployeeId]);

    const fetchAll = useCallback(async () => {
        try {
            const me = await apiClient.get<{ id: string }>('/hr/employees/me');
            const myEmployeeId = me.data?.id;

            const requests: Promise<any>[] = [
                apiClient.get<LeaveApplication[]>('/hr/leave'),
                apiClient.get<LeaveTypeOption[]>('/payroll/leave-types'),
                myEmployeeId ? apiClient.get<LeaveBalance[]>(`/payroll/leave-balance?employeeId=${myEmployeeId}`) : Promise.resolve(null),
            ];

            if (canApplyForOthers) {
                requests.push(apiClient.get<EmployeeOption[]>('/hr/employees?status=active'));
            }

            const [appsRes, typesRes, balanceRes, empsRes] = await Promise.all(requests);

            if (appsRes.success && appsRes.data) setApplications(appsRes.data);
            if (typesRes.success && typesRes.data) setLeaveTypes(typesRes.data);
            if (balanceRes?.success && balanceRes.data) setBalances(balanceRes.data);
            if (empsRes?.success && empsRes.data) setEmployees(empsRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch leave data.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [canApplyForOthers, toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Load selected employee's balances in modal
    const handleTargetEmployeeChange = async (empId: string) => {
        setTargetEmployeeId(empId);
        // Clear immediately — otherwise a failed fetch below would silently leave the
        // PREVIOUSLY selected employee's balance numbers on screen against the new employee.
        setTargetBalances([]);
        if (!empId) return;
        setLoadingTargetBalances(true);
        try {
            const res = await apiClient.get<LeaveBalance[]>(`/payroll/leave-balance?employeeId=${empId}`);
            if (res.success && res.data) {
                setTargetBalances(res.data);
            } else {
                toast({ title: 'Error', description: res.error || 'Could not load balances for this employee.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not load employee balances.', variant: 'destructive' });
        } finally {
            setLoadingTargetBalances(false);
        }
    };

    const handleApply = async () => {
        try {
            const payload: any = {
                leaveTypeId,
                fromDate,
                toDate,
                reason: reason || null,
            };

            if (isSingleDaySelected && isHalfDay) {
                payload.isHalfDay = true;
                payload.halfDaySession = halfDaySession;
            }

            if (applyFor === 'OTHER' && targetEmployeeId) {
                payload.employeeId = targetEmployeeId;
            }

            if (proofFiles.length > 0) {
                payload.attachments = proofFiles.map((f) => ({ fileKey: f.fileKey, fileName: f.fileName }));
            }

            const res = await apiClient.post('/hr/leave/apply', payload);
            if (res.success) {
                toast({ title: 'Submitted', description: 'Leave application submitted successfully.' });
                setIsApplyOpen(false);
                setLeaveTypeId(''); setFromDate(''); setToDate(''); setReason('');
                setIsHalfDay(false); setHalfDaySession('FIRST_HALF');
                setApplyFor('SELF'); setTargetEmployeeId(''); setTargetBalances([]);
                setProofFiles([]);
                await fetchAll();
            } else {
                throw new Error(res.error || 'Submission failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Submission failed.', variant: 'destructive' });
        }
    };

    const handleProofSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (picked.length === 0) return;
        if (proofFiles.length + picked.length > PROOF_MAX_FILES) {
            toast({ title: 'Too many files', description: `You can attach at most ${PROOF_MAX_FILES} files.`, variant: 'destructive' });
            return;
        }
        setIsUploadingProof(true);
        try {
            const uploaded: ProofFile[] = [];
            for (const file of picked) {
                if (!PROOF_TYPES.includes(file.type)) throw new Error(`"${file.name}" is not a PDF, JPG or PNG file.`);
                if (file.size > PROOF_MAX_BYTES) throw new Error(`"${file.name}" is larger than 5 MB.`);

                // Compress before uploading — photo snapshots can be several MBs;
                // automatically no-ops for PDFs.
                let fileToUpload = file;
                if (file.type.startsWith('image/')) {
                    try {
                        const result = await compressImageForCategory(file, 'document');
                        fileToUpload = result.compressedFile;
                    } catch {
                        // Fall back to original file if client compression fails
                    }
                }

                const form = new FormData();
                form.append('file', fileToUpload);
                if (applyFor === 'OTHER' && targetEmployeeId) form.append('employeeId', targetEmployeeId);
                const res = await apiClient.post<ProofFile>('/hr/leave/attachments/upload', form);
                if (!res.success || !res.data) throw new Error(res.error || `Could not upload "${file.name}".`);
                uploaded.push({ fileKey: res.data.fileKey, fileName: file.name, fileSize: res.data.fileSize });
            }
            setProofFiles((prev) => [...prev, ...uploaded]);
        } catch (error: any) {
            toast({ title: 'Upload failed', description: error.message || 'Could not upload the file.', variant: 'destructive' });
        } finally {
            setIsUploadingProof(false);
        }
    };

    const openAttachment = async (applicationId: string, attachmentId: string) => {
        try {
            const res = await apiClient.get<{ url: string }>(`/hr/leave/${applicationId}/attachments/${attachmentId}`);
            if (!res.success || !res.data?.url) throw new Error(res.error || 'Could not open the file.');
            window.open(res.data.url, '_blank', 'noopener');
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Could not open the file.', variant: 'destructive' });
        }
    };

    const handleCancel = async (app: LeaveApplication) => {
        try {
            const res = await apiClient.post(`/hr/leave/${app.id}/cancel`);
            if (res.success) {
                toast({ title: 'Cancelled', description: 'Leave application cancelled.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Cancellation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Cancellation failed.', variant: 'destructive' });
        }
    };

    const selectedEmployee = employees.find((e) => e.id === targetEmployeeId);

    // Loss-of-Pay is a system-assigned outcome (excess-over-balance days on
    // approval), never a category an employee applies for directly.
    const applicableLeaveTypes = leaveTypes.filter((t) => !t.isLop);

    // Balance warning — informational only, never blocks Submit (the employee
    // can still apply with insufficient balance; the excess is settled as
    // Loss of Pay at approval time, see /api/hr/leave/[id]/approve).
    const selectedLeaveTypeName = applicableLeaveTypes.find((t) => t.id === leaveTypeId)?.leaveType ?? '';
    const activeBalances = applyFor === 'OTHER' ? targetBalances : balances;
    const selectedBalance = activeBalances.find((b) => b.leaveType === selectedLeaveTypeName);
    const remainingForSelected = selectedBalance ? (Number(selectedBalance.remainingBalance) || 0) : 0;
    const isSingleDaySelected = !!fromDate && !!toDate && fromDate === toDate;
    const requestedDays = isSingleDaySelected && isHalfDay ? 0.5 : calendarDaysBetween(fromDate, toDate);
    const excessIfApplied = leaveTypeId && requestedDays > 0 ? Math.max(0, requestedDays - remainingForSelected) : 0;

    // Proof rule from the Leave Type master: required when the leave is MORE THAN N days (0 = always).
    const proofRule = applicableLeaveTypes.find((t) => t.id === leaveTypeId)?.attachmentRequiredAboveDays;
    const hasProofRule = proofRule !== null && proofRule !== undefined;
    const proofRequired = hasProofRule && requestedDays > Number(proofRule);

    if (isLoading) {
        return <PageLoader label="Loading Leave..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <CalendarRange className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">My Leave</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Apply, track and cancel your leave requests.</p>
                        </div>
                    </div>
                    <Button onClick={() => setIsApplyOpen(true)} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Apply for Leave
                    </Button>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Leave Balance</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                        {balances.length === 0 ? (
                            <p className="text-sm text-slate-500 col-span-3">No leave balance configured yet.</p>
                        ) : (
                            balances.map((b) => (
                                <div key={b.id} className="border rounded-md p-3 text-center bg-white/50 dark:bg-slate-900/40">
                                    <div className="text-xs uppercase text-slate-500">{b.leaveType}</div>
                                    <div className="text-2xl font-bold text-primary">{formatDays(b.remainingBalance)}</div>
                                    {b.allowCarryForward && Number(b.carriedForwardDays) > 0 ? (
                                        <div className="text-xs text-slate-400">
                                            {formatDays(b.openingBalance)} quota + {formatDays(b.carriedForwardDays!)} carried forward
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-400">of {formatDays(b.openingBalance)} days</div>
                                    )}
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Leave Type</TableHead>
                                        <TableHead>From — To</TableHead>
                                        <TableHead>Days</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Attachment</TableHead>
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {applications.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                                No leave applications yet.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        applications.map((app) => (
                                            <TableRow key={app.id}>
                                                <TableCell className="text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{app.leaveType.leaveType}</span>
                                                        {app.isHalfDay && app.halfDaySession && (
                                                            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                                                                Half Day ({app.halfDaySession === 'FIRST_HALF' ? 'First Half' : 'Second Half'})
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {toDisplayDate(new Date(app.fromDate))} — {toDisplayDate(new Date(app.toDate))}
                                                </TableCell>
                                                <TableCell className="text-sm font-medium">{formatDays(app.numberOfDays)}</TableCell>
                                                <TableCell className="text-sm">
                                                    {(app.attachments ?? []).length === 0 ? (
                                                        <span className="text-xs text-slate-400">—</span>
                                                    ) : (
                                                        <div className="flex flex-col gap-1">
                                                            {app.attachments!.map((a) => (
                                                                <Button
                                                                    key={a.id}
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-7 justify-start gap-1.5 px-2 text-xs"
                                                                    onClick={() => openAttachment(app.id, a.id)}
                                                                    title={a.fileName}
                                                                >
                                                                    <Paperclip className="h-3 w-3 shrink-0" />
                                                                    <span className="max-w-[9rem] truncate">View {a.fileName}</span>
                                                                </Button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell><Badge variant={statusVariant(app.status)}>{app.status}</Badge></TableCell>
                                                <TableCell className="text-center">
                                                    {app.status === 'PENDING' && (
                                                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleCancel(app)} title="Cancel">
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
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Apply for Leave</DialogTitle>
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
                                        onClick={() => { setApplyFor('SELF'); setTargetEmployeeId(''); setTargetBalances([]); }}
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
                                                        setTargetBalances([]);
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
                                            <Select value={targetEmployeeId} onValueChange={handleTargetEmployeeChange}>
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

                                        {targetEmployeeId && (
                                            <div className="mt-2 rounded-md border border-primary/20 bg-green-50/40 dark:bg-brand-green-darker/20 p-2 text-xs">
                                                <div className="font-semibold text-primary mb-1">
                                                    {selectedEmployee?.firstName}&apos;s Remaining Balances:
                                                </div>
                                                {loadingTargetBalances ? (
                                                    <p className="text-slate-500">Loading balances...</p>
                                                ) : targetBalances.length === 0 ? (
                                                    <p className="text-slate-500">No balance configured yet.</p>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {targetBalances.map((b) => (
                                                            <Badge key={b.id} variant="outline" className="bg-white dark:bg-slate-900 text-xs">
                                                                {b.leaveType}: <strong className="ml-1 text-primary">{formatDays(b.remainingBalance)}</strong>
                                                                {b.allowCarryForward && Number(b.carriedForwardDays) > 0 && (
                                                                    <span className="ml-1 text-slate-400">(+{formatDays(b.carriedForwardDays!)} carried)</span>
                                                                )}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Leave Type</Label>
                            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                                <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                                <SelectContent>
                                    {applicableLeaveTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.leaveType}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>From Date</Label>
                                <DatePickerField value={fromDate} onChange={setFromDate} />
                            </div>
                            <div className="space-y-2">
                                <Label>To Date</Label>
                                <DatePickerField value={toDate} onChange={setToDate} />
                            </div>
                        </div>

                        {isSingleDaySelected && (
                            <div className="space-y-2 rounded-md border border-primary/20 p-3">
                                <label className="flex items-center gap-2 text-sm font-medium">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4"
                                        checked={isHalfDay}
                                        onChange={(e) => setIsHalfDay(e.target.checked)}
                                    />
                                    Half Day
                                </label>
                                {isHalfDay && (
                                    <Select value={halfDaySession} onValueChange={(v) => setHalfDaySession(v as 'FIRST_HALF' | 'SECOND_HALF')}>
                                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="FIRST_HALF">First Half</SelectItem>
                                            <SelectItem value="SECOND_HALF">Second Half</SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Reason (optional)</Label>
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Provide reason for leave" />
                        </div>

                        {hasProofRule && (
                            <div className="space-y-2">
                                <Label>
                                    Proof attachment{' '}
                                    <span className={proofRequired ? 'text-red-600' : 'text-slate-500'}>
                                        {proofRequired ? '(required)' : '(optional)'}
                                    </span>
                                </Label>
                                <p className="text-xs text-slate-500">
                                    {Number(proofRule) <= 0
                                        ? `${selectedLeaveTypeName} always needs proof (for example a medical certificate).`
                                        : `${selectedLeaveTypeName} for more than ${Number(proofRule)} day(s) needs proof (for example a medical certificate).`}{' '}
                                    PDF, JPG or PNG, up to {PROOF_MAX_FILES} files, 5 MB each.
                                </p>
                                <Input
                                    type="file"
                                    accept="application/pdf,image/jpeg,image/png"
                                    multiple
                                    onChange={handleProofSelect}
                                    disabled={isUploadingProof || proofFiles.length >= PROOF_MAX_FILES}
                                />
                                {isUploadingProof && <p className="text-xs text-slate-500">Uploading...</p>}
                                {proofFiles.length > 0 && (
                                    <ul className="space-y-1">
                                        {proofFiles.map((f) => (
                                            <li key={f.fileKey} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-xs dark:border-sidebar-accent">
                                                <span className="flex items-center gap-1 truncate"><Paperclip className="h-3 w-3" />{f.fileName}</span>
                                                <button
                                                    type="button"
                                                    className="text-red-600"
                                                    onClick={() => setProofFiles((prev) => prev.filter((x) => x.fileKey !== f.fileKey))}
                                                >
                                                    Remove
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        {excessIfApplied > 0 && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-semibold">Insufficient balance</div>
                                    {applyFor === 'OTHER' ? (selectedEmployee?.firstName ?? 'This employee') : 'You'} {applyFor === 'OTHER' ? 'has' : 'have'} only{' '}
                                    <b>{remainingForSelected}</b> day(s) of <b>{selectedLeaveTypeName}</b> remaining, but this request is for{' '}
                                    <b>{requestedDays}</b> day(s). You can still submit — if approved, <b>{excessIfApplied}</b> day(s) will be marked
                                    as <b>Loss of Pay</b>.
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsApplyOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleApply}
                            disabled={!leaveTypeId || !fromDate || !toDate || (applyFor === 'OTHER' && !targetEmployeeId) || isUploadingProof || (proofRequired && proofFiles.length === 0)}
                        >
                            Submit
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
