'use client';

import { useState, useEffect, useCallback } from 'react';
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Clock, CheckCircle2, XCircle, Ban, LayoutGrid, TableIcon, CalendarDays, FileText, MessageSquare } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermission } from '@/app/hooks/usePermission';
import { AwaitingApprovalStage, type RecordApproval } from '@/components/hr/AwaitingApprovalStage';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDate } from '@/app/lib/date-format';

type PermissionRequest = {
    id: string;
    date: string;
    fromTime: string;
    toTime: string;
    hours: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    reason: string | null;
    approvalRemarks: string | null;
    cancelReason: string | null;
    triggeredLop: boolean;
    employee: { firstName: string; lastName: string; employeeId: string | null };
    permissionType: { permissionType: string };
    approval: RecordApproval | null;
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED' || status === 'CANCELLED') return 'destructive';
    return 'outline';
}

const STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function PermissionApprovalQueue() {
    const { toast } = useToast();
    const { can } = usePermission();
    // Dynamic permission from Role Permissions Editor (no hardcoded roles) —
    // matches the backend's requirePermission('hr-leave', 'override') gate.
    const canOverride = can('hr-leave', 'override');
    const [rows, setRows] = useState<PermissionRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [rejectTarget, setRejectTarget] = useState<PermissionRequest | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [cancelTarget, setCancelTarget] = useState<PermissionRequest | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

    const fetchAll = useCallback(async () => {
        try {
            const res = await apiClient.get<PermissionRequest[]>('/hr/permission?scope=team');
            if (res.success && res.data) setRows(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch team permission requests.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleApprove = async (row: PermissionRequest) => {
        try {
            const res = await apiClient.post(`/hr/permission/${row.id}/approve`);
            if (res.success) {
                toast({ title: 'Approved', description: res.message || 'Permission request approved.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Approval failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Approval failed.', variant: 'destructive' });
        }
    };

    const handleRejectConfirm = async () => {
        if (!rejectTarget || !rejectReason.trim()) return;
        try {
            const res = await apiClient.post(`/hr/permission/${rejectTarget.id}/reject`, { approvalRemarks: rejectReason.trim() });
            if (res.success) {
                toast({ title: 'Rejected', description: 'Permission request rejected.' });
                setRejectTarget(null);
                setRejectReason('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Rejection failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Rejection failed.', variant: 'destructive' });
        }
    };

    const handleCancelConfirm = async () => {
        if (!cancelTarget || !cancelReason.trim()) return;
        try {
            const res = await apiClient.post(`/hr/permission/${cancelTarget.id}/admin-cancel`, { reason: cancelReason.trim() });
            if (res.success) {
                toast({ title: 'Approved Permission Cancelled', description: 'Worked hours recalculated for that day.' });
                setCancelTarget(null);
                setCancelReason('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Cancellation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Cancellation failed.', variant: 'destructive' });
        }
    };

    const statusFilteredRows = statusFilter === 'ALL' ? rows : rows.filter((r) => r.status === statusFilter);
    const { query: searchQuery, setQuery: setSearchQuery, filtered: visibleRows } = useTableSearch(statusFilteredRows);

    if (isLoading) {
        return <PageLoader label="Loading Permission Approvals..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Clock className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Permission Approval</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Team permission (gate-pass) requests — pending, approved and rejected.</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                        {STATUS_FILTERS.map((s) => {
                            const count = s === 'ALL' ? rows.length : rows.filter((r) => r.status === s).length;
                            return (
                                <Button
                                    key={s}
                                    size="sm"
                                    variant={statusFilter === s ? 'default' : 'outline'}
                                    onClick={() => setStatusFilter(s)}
                                >
                                    {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()} ({count})
                                </Button>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <TableSearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Search by employee ID or name..."
                        />
                        <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-sidebar-accent">
                            <Button
                                type="button"
                                size="sm"
                                variant={viewMode === 'card' ? 'default' : 'ghost'}
                                className="rounded-none gap-1.5"
                                onClick={() => setViewMode('card')}
                                title="Card view"
                            >
                                <LayoutGrid className="h-4 w-4" /> Cards
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={viewMode === 'table' ? 'default' : 'ghost'}
                                className="rounded-none gap-1.5"
                                onClick={() => setViewMode('table')}
                                title="Table view"
                            >
                                <TableIcon className="h-4 w-4" /> Table
                            </Button>
                        </div>
                    </div>
                </div>

                {viewMode === 'table' ? (
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table className="[&_th]:px-4 [&_td]:px-4">
                                    <TableHeader>
                                        <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                            <TableHead className="w-12">S.No</TableHead>
                                            <TableHead>Employee</TableHead>
                                            <TableHead>Permission Type</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Time</TableHead>
                                            <TableHead>Hours</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Reason</TableHead>
                                            <TableHead>Remarks</TableHead>
                                            <TableHead className="text-center">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {visibleRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={10} className="px-4 py-12 text-center text-slate-500">No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}permission requests.</TableCell>
                                            </TableRow>
                                        ) : (
                                            visibleRows.map((row, rowIndex) => (
                                                <TableRow key={row.id}>
                                                    <TableCell className="text-sm text-slate-500">{rowIndex + 1}</TableCell>
                                                    <TableCell className="text-sm font-medium">
                                                        {row.employee.firstName} {row.employee.lastName}
                                                        <div className="text-xs text-slate-500">{row.employee.employeeId}</div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{row.permissionType.permissionType}</TableCell>
                                                    <TableCell className="text-sm">{toDisplayDate(new Date(row.date))}</TableCell>
                                                    <TableCell className="text-sm">{row.fromTime} — {row.toTime}</TableCell>
                                                    <TableCell className="text-sm">{row.hours}</TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-1.5">
                                                            <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                                                            {row.triggeredLop && (
                                                                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 shadow-sm text-[10px]" title="This permission hit the cycle limit — the day was marked Absent (LOP).">
                                                                    LOP
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {row.status === 'PENDING' && <AwaitingApprovalStage approval={row.approval} />}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-slate-500 max-w-[220px]">{row.reason || '—'}</TableCell>
                                                    <TableCell className="text-sm text-slate-500 max-w-[220px]">
                                                        {row.status === 'REJECTED' ? (row.approvalRemarks || '—')
                                                            : row.status === 'CANCELLED' ? (row.cancelReason || '—')
                                                            : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {row.status === 'PENDING' && row.approval?.canAct !== false && (
                                                            <div className="flex items-center justify-center gap-1">
                                                                <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleApprove(row)} title="Approve">
                                                                    <CheckCircle2 className="h-4 w-4" />
                                                                </Button>
                                                                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRejectTarget(row)} title="Reject">
                                                                    <XCircle className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        )}
                                                        {row.status === 'APPROVED' && canOverride && (
                                                            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelTarget(row)} title="Cancel approved permission">
                                                                <Ban className="h-4 w-4" />
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
                ) : visibleRows.length === 0 ? (
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="px-4 py-12 text-center text-slate-500">
                            No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}permission requests.
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {visibleRows.map((row) => (
                            <Card
                                key={row.id}
                                className="border-primary/20 bg-white/80 shadow-md transition-shadow hover:shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker/40"
                            >
                                <CardContent className="p-4 sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex items-start gap-3">
                                            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary dark:bg-sidebar-accent/30 dark:text-slate-100">
                                                {(row.employee.firstName?.[0] ?? '').toUpperCase()}{(row.employee.lastName?.[0] ?? '').toUpperCase()}
                                            </span>
                                            <div>
                                                <div className="flex items-center gap-2 text-base font-semibold text-sidebar-accent dark:text-slate-100">
                                                    {row.employee.firstName} {row.employee.lastName}
                                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500 dark:bg-sidebar-accent/30">
                                                        {row.employee.employeeId}
                                                    </span>
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-slate-500">
                                                    <span>{row.permissionType.permissionType}</span>
                                                    <span>·</span>
                                                    <span className="inline-flex items-center gap-1">
                                                        <CalendarDays className="h-3 w-3" />
                                                        {toDisplayDate(new Date(row.date))}
                                                    </span>
                                                    <span>·</span>
                                                    <span>{row.fromTime} — {row.toTime}</span>
                                                    <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">{row.hours} hr(s)</Badge>
                                                    {row.triggeredLop && (
                                                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 shadow-sm text-[10px]" title="This permission hit the cycle limit — the day was marked Absent (LOP).">
                                                            LOP
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <Badge variant={statusVariant(row.status)} className="mr-1">{row.status}</Badge>
                                            {row.status === 'PENDING' && row.approval?.canAct !== false && (
                                                <>
                                                    <Button size="sm" variant="ghost" className="text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/40" onClick={() => handleApprove(row)} title="Approve">
                                                        <CheckCircle2 className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" onClick={() => setRejectTarget(row)} title="Reject">
                                                        <XCircle className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            )}
                                            {row.status === 'APPROVED' && canOverride && (
                                                <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" onClick={() => setCancelTarget(row)} title="Cancel approved permission">
                                                    <Ban className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {row.status === 'PENDING' && <div className="mt-1"><AwaitingApprovalStage approval={row.approval} /></div>}

                                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 dark:border-sidebar-accent/40 sm:grid-cols-2">
                                        <div>
                                            <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                                                <FileText className="h-3 w-3" /> Reason
                                            </div>
                                            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{row.reason || '—'}</div>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                                                <MessageSquare className="h-3 w-3" /> Remarks
                                            </div>
                                            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                                {row.status === 'REJECTED' ? (row.approvalRemarks || '—')
                                                    : row.status === 'CANCELLED' ? (row.cancelReason || '—')
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Reject Permission Request</DialogTitle></DialogHeader>
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

            <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Cancel Approved Permission</DialogTitle></DialogHeader>
                    <div className="space-y-2 py-2">
                        <p className="text-sm text-slate-500">
                            If the employee already punched out that day, their worked hours will be
                            recalculated without this permission&rsquo;s deduction.
                        </p>
                        <Label>Reason</Label>
                        <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why is this approved permission being cancelled?" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep Permission</Button>
                        <Button variant="destructive" onClick={handleCancelConfirm} disabled={!cancelReason.trim()}>Cancel Permission</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
