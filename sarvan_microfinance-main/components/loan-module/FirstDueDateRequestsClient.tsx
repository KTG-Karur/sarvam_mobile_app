'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { apiClient } from '@/app/lib/api-client';
import { usePermission } from '@/app/hooks/usePermission';
import { useToast } from '@/hooks/use-toast';
import { formatYmd } from '@/components/loan-module/FirstDueDateChangeRequestButton';
import { meetingDayError, requiredMeetingWeekday } from '@/app/lib/first-due-date-meeting-day';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Person = { id: string; firstName: string; lastName: string };

interface RequestRow {
    id: string;
    indexId: string;
    indexNo: string;
    indexDate: string;
    centerName: string;
    meetingDay: string | null;
    frequency: string | null;
    totalApps: number;
    totalAmount: number;
    branch: { id: string; name: string };
    oldFirstDueDate: string | null;
    newFirstDueDate: string | null;
    reason: string;
    status: Status;
    requestedAt: string;
    requestedBy: Person;
    decidedAt: string | null;
    decidedBy: Person | null;
    decisionRemarks: string | null;
}

interface ListResponse {
    requests: RequestRow[];
    totalCount: number;
    totalPages: number;
    page: number;
}

const PAGE_HREF = '/dashboard/loan-module/first-due-date-requests';

const statusBadge = (status: Status) => {
    switch (status) {
        case 'PENDING':
            return <Badge variant="secondary">Pending</Badge>;
        case 'APPROVED':
            return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Approved</Badge>;
        case 'REJECTED':
            return <Badge variant="destructive">Rejected</Badge>;
        case 'CANCELLED':
            return <Badge variant="outline">Cancelled</Badge>;
    }
};

const personName = (p: Person | null) => (p ? `${p.firstName} ${p.lastName}` : '—');
const formatDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN') : '—');

export function FirstDueDateRequestsClient() {
    const { toast } = useToast();
    const { canPage } = usePermission();
    const canAct = canPage(PAGE_HREF, 'approve');

    const [rows, setRows] = useState<RequestRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [status, setStatus] = useState<string>('PENDING');
    const [branchId, setBranchId] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    const [approveTarget, setApproveTarget] = useState<RequestRow | null>(null);
    const [newDate, setNewDate] = useState('');
    const [remarks, setRemarks] = useState('');
    const [rejectTarget, setRejectTarget] = useState<RequestRow | null>(null);
    const [rejectRemarks, setRejectRemarks] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchRequests = useCallback(
        async (targetPage: number, statusFilter: string) => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
                if (statusFilter !== 'all') params.set('status', statusFilter);
                if (branchId) params.set('branchId', branchId);
                if (from) params.set('from', from);
                if (to) params.set('to', to);
                const result = await apiClient.get<ListResponse>(`/first-due-date-change-requests?${params}`);
                if (result.success && result.data) {
                    setRows(result.data.requests);
                    setTotalPages(result.data.totalPages);
                    setTotalCount(result.data.totalCount);
                    setPage(result.data.page);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to load requests', variant: 'destructive' });
                }
            } catch {
                toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        },
        [toast, branchId, from, to, pageSize]
    );

    // Re-query whenever a filter changes (date fields wait until both ends are valid)
    useEffect(() => {
        if (from && to && from > to) return;
        fetchRequests(1, status);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, branchId, from, to, pageSize]);

    const submit = async (path: string, body: object, successMsg: string, onDone: () => void) => {
        setIsSubmitting(true);
        try {
            const res = await apiClient.post(path, body);
            if (res.success) {
                toast({ title: 'Done', description: successMsg });
                onDone();
                await fetchRequests(page, status);
            } else {
                toast({ title: 'Error', description: res.error || 'Action failed', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const approveMin = approveTarget ? approveTarget.indexDate.slice(0, 10) : undefined;
    const dayError = approveTarget && newDate ? meetingDayError(newDate, approveTarget.meetingDay, approveTarget.frequency) : null;
    const requiredDay = approveTarget ? requiredMeetingWeekday(approveTarget.meetingDay, approveTarget.frequency) : null;
    const dateInvalid = !newDate || (!!approveMin && newDate < approveMin) || !!dayError;

    return (
        <div className="space-y-4 p-4">
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <CalendarClock className="h-5 w-5" /> First Due Date Change Requests
                            </CardTitle>
                            <CardDescription>
                                Raised by Branch Managers for indexes in Final Disbursement. Approving applies the new date to every
                                undisbursed loan in the index.
                            </CardDescription>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-end gap-4">
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Status</div>
                            <Select value={status} onValueChange={setStatus}>
                                <SelectTrigger className="h-10 w-40">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="PENDING">Pending</SelectItem>
                                    <SelectItem value="APPROVED">Approved</SelectItem>
                                    <SelectItem value="REJECTED">Rejected</SelectItem>
                                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <LocalBranchFilter value={branchId} onChange={setBranchId} />
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Raised from</div>
                            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-10 w-40" />
                        </div>
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Raised to</div>
                            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-10 w-40" />
                        </div>
                        {(branchId || from || to) && (
                            <Button type="button" variant="outline" onClick={() => { setBranchId(''); setFrom(''); setTo(''); }}>
                                Clear
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <PageLoader />
                    ) : rows.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No requests found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Index</TableHead>
                                        <TableHead>Center / Branch</TableHead>
                                        <TableHead>Loans / Amount</TableHead>
                                        <TableHead>Current → New Date</TableHead>
                                        <TableHead>Reason</TableHead>
                                        <TableHead>Raised By</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Decision</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell>
                                                <div className="font-medium">{row.indexNo}</div>
                                                <div className="text-xs text-muted-foreground">Created {formatYmd(row.indexDate)}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div>{row.centerName}</div>
                                                <div className="text-xs text-muted-foreground">{row.branch.name}</div>
                                            </TableCell>
                                            <TableCell>
                                                {row.totalApps} · ₹{new Intl.NumberFormat('en-IN').format(row.totalAmount)}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                {formatYmd(row.oldFirstDueDate)} → {formatYmd(row.newFirstDueDate)}
                                            </TableCell>
                                            <TableCell className="max-w-xs whitespace-pre-wrap break-words text-sm">{row.reason}</TableCell>
                                            <TableCell>
                                                <div>{personName(row.requestedBy)}</div>
                                                <div className="text-xs text-muted-foreground">{formatDateTime(row.requestedAt)}</div>
                                            </TableCell>
                                            <TableCell>{statusBadge(row.status)}</TableCell>
                                            <TableCell className="text-sm">
                                                {row.decidedAt ? (
                                                    <>
                                                        <div>{personName(row.decidedBy)}</div>
                                                        <div className="text-xs text-muted-foreground">{formatDateTime(row.decidedAt)}</div>
                                                        {row.decisionRemarks && <div className="text-xs">{row.decisionRemarks}</div>}
                                                    </>
                                                ) : (
                                                    '—'
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {row.status === 'PENDING' && canAct ? (
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                            onClick={() => { setRejectTarget(row); setRejectRemarks(''); }}
                                                        >
                                                            <X className="mr-1 h-3.5 w-3.5" /> Reject
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            onClick={() => { setApproveTarget(row); setNewDate(''); setRemarks(''); }}
                                                        >
                                                            <Check className="mr-1 h-3.5 w-3.5" /> Approve
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {totalCount > 0 && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t px-1 py-4">
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span>
                                    Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount} record{totalCount !== 1 ? 's' : ''}
                                </span>
                                <div className="flex items-center gap-2">
                                    <span>Rows per page</span>
                                    <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                                        <SelectTrigger className="h-8 w-20">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[10, 25, 50, 100].map((n) => (
                                                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button variant="outline" size="sm" onClick={() => fetchRequests(1, status)} disabled={page === 1 || isLoading}>
                                    First
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => fetchRequests(Math.max(1, page - 1), status)} disabled={page === 1 || isLoading}>
                                    Previous
                                </Button>
                                <span className="px-2 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                                <Button variant="outline" size="sm" onClick={() => fetchRequests(Math.min(totalPages, page + 1), status)} disabled={page >= totalPages || isLoading}>
                                    Next
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => fetchRequests(totalPages, status)} disabled={page >= totalPages || isLoading}>
                                    Last
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Approve: approver picks the new date */}
            <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o && !isSubmitting) setApproveTarget(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Approve & set new first due date</DialogTitle>
                        <DialogDescription>
                            Index {approveTarget?.indexNo} · current {formatYmd(approveTarget?.oldFirstDueDate)}. The new date is
                            applied to all undisbursed loans in this index.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="rounded-md bg-muted p-2 text-sm">
                            <span className="font-medium">BM&apos;s reason: </span>{approveTarget?.reason}
                        </div>
                        <div className="space-y-1">
                            <Label>New first due date</Label>
                            <Input type="date" value={newDate} min={approveMin} onChange={(e) => setNewDate(e.target.value)} />
                            <p className="text-xs text-muted-foreground">
                                Dates before the index creation date ({formatYmd(approveMin)}) are not allowed.
                                {requiredDay !== null && ` Must be a ${approveTarget?.meetingDay?.toLowerCase()} (center meeting day).`}
                            </p>
                            {dayError && <p className="text-xs text-red-600">{dayError}</p>}
                        </div>
                        <div className="space-y-1">
                            <Label>Remarks (optional)</Label>
                            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} maxLength={500} />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={isSubmitting}>Cancel</Button>
                        <Button
                            disabled={isSubmitting || dateInvalid}
                            onClick={() =>
                                approveTarget &&
                                submit(
                                    `/first-due-date-change-requests/${approveTarget.id}/approve`,
                                    { newFirstDueDate: newDate, remarks: remarks.trim() || undefined },
                                    'First due date updated',
                                    () => setApproveTarget(null)
                                )
                            }
                        >
                            {isSubmitting ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Approving...</> : 'Approve'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reject: remarks required */}
            <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o && !isSubmitting) setRejectTarget(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reject request</DialogTitle>
                        <DialogDescription>Index {rejectTarget?.indexNo} keeps its current first due date.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label>Remarks</Label>
                        <Textarea value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} rows={3} maxLength={500} placeholder="Why is this being rejected?" />
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={isSubmitting}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={isSubmitting || rejectRemarks.trim().length < 3}
                            onClick={() =>
                                rejectTarget &&
                                submit(
                                    `/first-due-date-change-requests/${rejectTarget.id}/reject`,
                                    { remarks: rejectRemarks.trim() },
                                    'Request rejected',
                                    () => setRejectTarget(null)
                                )
                            }
                        >
                            {isSubmitting ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Rejecting...</> : 'Reject'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
