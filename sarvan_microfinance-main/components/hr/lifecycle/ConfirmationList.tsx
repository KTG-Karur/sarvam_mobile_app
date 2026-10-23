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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { BadgeCheck, Plus, Download, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { AwaitingApprovalStage, type RecordApproval } from '@/components/hr/AwaitingApprovalStage';
import { downloadBlobFile } from '@/app/lib/download-letter';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type Employee = {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string | null;
    dateOfJoining?: string | null;
    confirmationDate?: string | null;
    isActive?: boolean;
    branch?: { id?: string; name: string; code?: string } | null;
};

type Confirmation = {
    id: string;
    proposedConfirmationDate: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    letterUrl: string | null;
    reviewRemarks: string | null;
    employee: {
        id: string;
        firstName: string;
        lastName: string;
        employeeId: string | null;
        dateOfJoining?: string | null;
        branch: { name: string } | null;
    };
    initiatedBy: { firstName: string; lastName: string } | null;
    reviewedBy: { firstName: string; lastName: string } | null;
    approval?: RecordApproval | null;
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED') return 'destructive';
    return 'outline';
}

function addMonths(dateStr: string | Date, months: number): Date {
    const d = new Date(dateStr);
    const dayOfMonth = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // A joining date like 31 Aug + 6 months must land on 28/29 Feb, not roll
    // over into March (plain setMonth overflows into the next month).
    const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, lastDayOfTarget));
    return d;
}

function toYmd(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Bare toLocaleDateString() follows the browser/OS locale — on a US-locale
// machine that renders M/D/YYYY, easily misread as day-first. Pinning to
// en-IN forces DD/MM/YYYY on every browser, matching the staff-loans pages'
// convention.
function formatDisplayDate(d: Date | string): string {
    return toDisplayDate(new Date(d));
}

type DueStatus = 'overdue' | 'due_soon' | 'upcoming';

function getDueStatus(dueDate: Date): DueStatus {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDay = new Date(dueDate);
    dueDay.setHours(0, 0, 0, 0);

    const thirtyDaysAhead = new Date(today);
    thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);

    if (dueDay <= today) {
        return 'overdue';
    }
    if (dueDay <= thirtyDaysAhead) {
        return 'due_soon';
    }
    return 'upcoming';
}

export function ConfirmationList() {
    const { toast } = useToast();
    const [rows, setRows] = useState<Confirmation[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [probationMonths, setProbationMonths] = useState<number>(6);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'all' | 'due'>('all');
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [employeeId, setEmployeeId] = useState('');
    const [confirmationDate, setConfirmationDate] = useState('');
    const [rejectTarget, setRejectTarget] = useState<Confirmation | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const [rowsRes, employeesRes, configRes] = await Promise.all([
                apiClient.get<Confirmation[]>('/hr/confirmations'),
                apiClient.get<Employee[]>('/hr/employees'),
                apiClient.get<{ probationMonths: number }>('/hr/probation-config'),
            ]);
            if (rowsRes.success && rowsRes.data) setRows(rowsRes.data);
            if (employeesRes.success && employeesRes.data) setEmployees(employeesRes.data);
            if (configRes.success && configRes.data?.probationMonths) {
                setProbationMonths(configRes.data.probationMonths);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch confirmations.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const pendingEmployeeIds = useMemo(() => {
        return new Set(rows.filter((r) => r.status === 'PENDING').map((r) => r.employee.id));
    }, [rows]);

    // Employees without dateOfJoining are silently skipped from due computation (not flagged as an error, just excluded)
    const eligibleEmployees = useMemo(() => {
        return employees
            .filter((e) => {
                if (e.isActive === false) return false;
                if (e.confirmationDate) return false;
                if (pendingEmployeeIds.has(e.id)) return false;
                if (!e.dateOfJoining) return false;
                return true;
            })
            .map((e) => {
                const dueDate = addMonths(e.dateOfJoining!, probationMonths);
                const dueStatus = getDueStatus(dueDate);
                return {
                    ...e,
                    dueDate,
                    dueStatus,
                };
            })
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    }, [employees, pendingEmployeeIds, probationMonths]);

    const handleInitiateClick = () => {
        setEmployeeId('');
        setConfirmationDate('');
        setIsCreateOpen(true);
    };

    const handleInitiateForEmployee = (emp: (typeof eligibleEmployees)[0]) => {
        setEmployeeId(emp.id);
        setConfirmationDate(toYmd(emp.dueDate));
        setIsCreateOpen(true);
    };

    const handleEmployeeSelect = (selectedId: string) => {
        setEmployeeId(selectedId);
        const emp = employees.find((e) => e.id === selectedId);
        if (emp?.dateOfJoining) {
            const due = addMonths(emp.dateOfJoining, probationMonths);
            setConfirmationDate(toYmd(due));
        }
    };

    const handleCreate = async () => {
        if (!employeeId || !confirmationDate) return;
        try {
            const res = await apiClient.post<{ status: string }>('/hr/confirmations', { employeeId, proposedConfirmationDate: confirmationDate });
            if (res.success) {
                // Only a workflow that resolves straight to APPROVED produces the letter
                // right away — otherwise it waits for approval on this page.
                toast(res.data?.status === 'APPROVED'
                    ? { title: 'Confirmed', description: 'Confirmation letter generated — ready to download.' }
                    : { title: 'Submitted', description: 'Confirmation submitted for approval.' });
                setIsCreateOpen(false);
                setEmployeeId('');
                setConfirmationDate('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Creation failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Creation failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleApprove = async (row: Confirmation) => {
        try {
            const res = await apiClient.post(`/hr/confirmations/${row.id}/approve`);
            if (res.success) {
                toast({ title: 'Approved', description: res.message || 'Confirmation approved.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Approval failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Approval failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleRejectConfirm = async () => {
        if (!rejectTarget || !rejectReason.trim()) return;
        try {
            const res = await apiClient.post(`/hr/confirmations/${rejectTarget.id}/reject`, { reviewRemarks: rejectReason.trim() });
            if (res.success) {
                toast({ title: 'Rejected', description: 'Confirmation rejected.' });
                setRejectTarget(null);
                setRejectReason('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Rejection failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Rejection failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleDownloadLetter = async (row: Confirmation) => {
        try {
            const empCode = row.employee.employeeId || row.id;
            await downloadBlobFile(`/hr/confirmations/${row.id}/letter`, `confirmation-letter-${empCode}.pdf`);
            toast({ title: 'Success', description: 'Confirmation letter downloaded.' });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Could not download confirmation letter.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Confirmations..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <BadgeCheck className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Employee Confirmation</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                HR Initiation → Approval → Confirmation Letter generated.
                            </p>
                        </div>
                    </div>
                    <Button onClick={handleInitiateClick} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Initiate Confirmation
                    </Button>
                </div>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'all' | 'due')} className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <TabsList className="bg-muted/80 p-1">
                            <TabsTrigger value="all" className="data-[state=active]:bg-white dark:data-[state=active]:bg-brand-green-darker">
                                All Requests ({rows.length})
                            </TabsTrigger>
                            <TabsTrigger value="due" className="data-[state=active]:bg-white dark:data-[state=active]:bg-brand-green-darker flex items-center gap-1.5">
                                Due for Confirmation
                                {eligibleEmployees.length > 0 && (
                                    <span className="ml-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-2 py-0.5 text-xs font-semibold">
                                        {eligibleEmployees.length}
                                    </span>
                                )}
                            </TabsTrigger>
                        </TabsList>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/40 px-3 py-1.5 rounded-lg border border-border/50">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            <span>Probation Period: <strong className="font-semibold text-foreground">{probationMonths} months</strong></span>
                        </div>
                    </div>

                    <TabsContent value="all" className="mt-0">
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                                <TableHead>Employee</TableHead>
                                                <TableHead>Confirmation Date</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Initiated By</TableHead>
                                                <TableHead>Reviewed By</TableHead>
                                                <TableHead className="text-center">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {rows.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">No confirmation requests yet.</TableCell>
                                                </TableRow>
                                            ) : (
                                                rows.map((row) => {
                                                    const doj = row.employee.dateOfJoining || employees.find((e) => e.id === row.employee.id)?.dateOfJoining;
                                                    const showDueBadge = row.status === 'PENDING' && doj;
                                                    let dueBadge = null;
                                                    if (showDueBadge) {
                                                        const dueDate = addMonths(doj, probationMonths);
                                                        const status = getDueStatus(dueDate);
                                                        if (status === 'overdue') {
                                                            dueBadge = (
                                                                <Badge className="bg-amber-500/15 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 text-[10px] px-1.5 py-0 font-medium">
                                                                    Due
                                                                </Badge>
                                                            );
                                                        } else if (status === 'due_soon') {
                                                            dueBadge = (
                                                                <Badge variant="outline" className="text-slate-600 border-slate-300 dark:text-slate-300 dark:border-slate-700 text-[10px] px-1.5 py-0 font-medium">
                                                                    Due soon
                                                                </Badge>
                                                            );
                                                        }
                                                    }

                                                    return (
                                                        <TableRow key={row.id}>
                                                            <TableCell className="text-sm font-medium">
                                                                {row.employee.firstName} {row.employee.lastName}
                                                                <div className="text-xs text-slate-500">{row.employee.employeeId} · {row.employee.branch?.name}</div>
                                                            </TableCell>
                                                            <TableCell className="text-sm">{formatDisplayDate(row.proposedConfirmationDate)}</TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col items-start gap-1">
                                                                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                                                                    {row.status === 'PENDING' && <AwaitingApprovalStage approval={row.approval ?? null} />}
                                                                    {dueBadge}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-sm">{row.initiatedBy ? `${row.initiatedBy.firstName} ${row.initiatedBy.lastName}` : '—'}</TableCell>
                                                            <TableCell className="text-sm">{row.reviewedBy ? `${row.reviewedBy.firstName} ${row.reviewedBy.lastName}` : '—'}</TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center justify-center gap-1">
                                                                    {row.status === 'PENDING' && row.approval?.canAct !== false && (
                                                                        <>
                                                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleApprove(row)} title="Approve">
                                                                                <CheckCircle2 className="h-4 w-4" />
                                                                            </Button>
                                                                            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRejectTarget(row)} title="Reject">
                                                                                <XCircle className="h-4 w-4" />
                                                                            </Button>
                                                                        </>
                                                                    )}
                                                                    {(row.status === 'APPROVED' || row.letterUrl) && (
                                                                         <Button size="sm" variant="ghost" onClick={() => handleDownloadLetter(row)} title="Download Letter">
                                                                             <Download className="h-4 w-4" />
                                                                         </Button>
                                                                     )}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="due" className="mt-0">
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                                <TableHead>Employee</TableHead>
                                                <TableHead>Branch</TableHead>
                                                <TableHead>Date of Joining</TableHead>
                                                <TableHead>Due Date</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-center">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {eligibleEmployees.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                                        No employees currently due for confirmation.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                eligibleEmployees.map((emp) => (
                                                    <TableRow key={emp.id}>
                                                        <TableCell className="text-sm font-medium">
                                                            {emp.firstName} {emp.lastName}
                                                            <div className="text-xs text-slate-500">{emp.employeeId || '—'}</div>
                                                        </TableCell>
                                                        <TableCell className="text-sm">{emp.branch?.name || '—'}</TableCell>
                                                        <TableCell className="text-sm">{formatDisplayDate(emp.dateOfJoining!)}</TableCell>
                                                        <TableCell className="text-sm font-medium">{formatDisplayDate(emp.dueDate)}</TableCell>
                                                        <TableCell>
                                                            {emp.dueStatus === 'overdue' ? (
                                                                <Badge className="bg-amber-500/15 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 font-medium">
                                                                    Due
                                                                </Badge>
                                                            ) : emp.dueStatus === 'due_soon' ? (
                                                                <Badge variant="outline" className="text-slate-600 border-slate-300 dark:text-slate-300 dark:border-slate-700 font-medium">
                                                                    Due soon
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-slate-500 border-slate-200 dark:text-slate-400 font-medium">
                                                                    Upcoming
                                                                </Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            <Button
                                                                size="sm"
                                                                className="bg-primary text-white hover:bg-primary/90"
                                                                onClick={() => handleInitiateForEmployee(emp)}
                                                            >
                                                                <Plus className="h-3.5 w-3.5 mr-1" />
                                                                Initiate
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Initiate Confirmation</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Employee</Label>
                            <Select value={employeeId} onValueChange={handleEmployeeSelect}>
                                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                                <SelectContent>
                                    {employees
                                        .filter((e) => e.isActive !== false && !e.confirmationDate && !pendingEmployeeIds.has(e.id))
                                        .map((e) => (
                                            <SelectItem key={e.id} value={e.id}>
                                                {e.firstName} {e.lastName} ({e.employeeId || 'No ID'})
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Proposed Confirmation Date</Label>
                            <div className="flex gap-2">
                                <DateInput value={confirmationDate} onChange={(e) => setConfirmationDate(e.target.value)} />
                                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setConfirmationDate(toYmd(new Date()))}>
                                    Today
                                </Button>
                            </div>
                            {(() => {
                                const selEmp = employees.find((e) => e.id === employeeId);
                                if (selEmp?.dateOfJoining) {
                                    return (
                                        <p className="text-xs text-muted-foreground">
                                            Auto-calculated: DOJ ({formatDisplayDate(selEmp.dateOfJoining)}) + {probationMonths} months probation period. Freely editable.
                                        </p>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={!employeeId || !confirmationDate}>Submit</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Reject Confirmation</DialogTitle></DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label>Reason</Label>
                        <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleRejectConfirm} disabled={!rejectReason.trim()}>Reject</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
