'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Check, X, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { PageLoader } from '@/components/ui/page-loader';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { useToast } from '@/hooks/use-toast';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type MpinChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

interface MpinChangeRequestRow {
  id: string;
  status: MpinChangeRequestStatus;
  requestedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  employee: {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    branch: { id: string; name: string; code: string } | null;
  };
  approvedBy: { id: string; firstName: string; lastName: string } | null;
  rejectedBy: { id: string; firstName: string; lastName: string } | null;
}

interface ListResponse {
  requests: MpinChangeRequestRow[];
  totalCount: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

const statusBadge = (status: MpinChangeRequestStatus) => {
  switch (status) {
    case 'PENDING':
      return <Badge variant="secondary">Pending</Badge>;
    case 'APPROVED':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Approved</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">Rejected</Badge>;
    case 'COMPLETED':
      return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Completed</Badge>;
  }
};

export function MpinChangeRequestsClient() {
  const { toast } = useToast();

  const currentUser = tokenStorage.getUser();
  const canAct = currentUser?.role === 'ADMIN' || !!currentUser?.isSubAdmin;

  const [rows, setRows] = useState<MpinChangeRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [status, setStatus] = useState<string>('all');
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [approveTarget, setApproveTarget] = useState<MpinChangeRequestRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<MpinChangeRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const buildParams = useCallback(
    (targetPage: number) => {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (branchId) params.set('branchId', branchId);
      if (search.trim()) params.set('search', search.trim());
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      params.set('page', String(targetPage));
      params.set('pageSize', '10');
      return params.toString();
    },
    [status, branchId, search, from, to]
  );

  const fetchRequests = useCallback(
    async (targetPage: number) => {
      setIsLoading(true);
      try {
        const result = await apiClient.get<ListResponse>(`/employees/mpin-change-requests?${buildParams(targetPage)}`);
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
    [buildParams, toast]
  );

  useEffect(() => {
    fetchRequests(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onApplyFilters = () => {
    fetchRequests(1);
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    setIsSubmitting(true);
    try {
      const res = await apiClient.post(`/employees/mpin-change-requests/${approveTarget.id}/approve`);
      if (res.success) {
        toast({ title: 'Approved', description: 'The employee can now create a new mobile MPIN.' });
        setApproveTarget(null);
        await fetchRequests(page);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to approve request', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await apiClient.post(`/employees/mpin-change-requests/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      if (res.success) {
        toast({ title: 'Rejected', description: 'The MPIN change request has been rejected.' });
        setRejectTarget(null);
        setRejectReason('');
        await fetchRequests(page);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to reject request', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            MPIN Change Requests
          </CardTitle>
          <CardDescription>
            Review and approve or reject employee mobile MPIN change (forgot MPIN) requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" /> Status
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <LocalBranchFilter value={branchId} onChange={setBranchId} />
            <div className="space-y-2">
              <div className="text-sm font-medium">Employee</div>
              <Input placeholder="Name or employee code" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">From</div>
              <DateInput value={from} onChange={(e) => setFrom(e.target.value)} className="h-10" />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">To</div>
              <DateInput value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-40" />
            </div>
            <Button type="button" onClick={onApplyFilters} disabled={isLoading}>
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</> : 'Apply Filters'}
            </Button>
          </div>

          {isLoading ? (
            <PageLoader label="Loading requests..." />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No MPIN change requests found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Employee Code</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Request Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approved By</TableHead>
                    <TableHead>Approved Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.employee.firstName} {row.employee.lastName}</TableCell>
                      <TableCell>{row.employee.employeeId || '—'}</TableCell>
                      <TableCell>{row.employee.branch ? `${row.employee.branch.code} — ${row.employee.branch.name}` : '—'}</TableCell>
                      <TableCell>{toDisplayDate(new Date(row.requestedAt))}</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell>{row.approvedBy ? `${row.approvedBy.firstName} ${row.approvedBy.lastName}` : row.rejectedBy ? `${row.rejectedBy.firstName} ${row.rejectedBy.lastName}` : '—'}</TableCell>
                      <TableCell>{row.approvedAt ? toDisplayDate(new Date(row.approvedAt)) : row.rejectedAt ? toDisplayDate(new Date(row.rejectedAt)) : '—'}</TableCell>
                      <TableCell className="text-right">
                        {row.status === 'PENDING' && canAct ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { setRejectTarget(row); setRejectReason(''); }}>
                              <X className="mr-1 h-3.5 w-3.5" /> Reject
                            </Button>
                            <Button size="sm" onClick={() => setApproveTarget(row)}>
                              <Check className="mr-1 h-3.5 w-3.5" /> Approve
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">{row.status === 'PENDING' ? 'Pending' : '—'}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-1 py-4 mt-2">
              <p className="text-sm text-sidebar-accent dark:text-slate-400">
                Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => fetchRequests(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => fetchRequests(Math.min(totalPages, page + 1))} disabled={page === totalPages || isLoading}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve confirmation */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve MPIN Change Request?</DialogTitle>
            <DialogDescription>
              The employee will be allowed to create a new mobile MPIN. This does not set a new MPIN automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleApprove} disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Approving...</> : 'Approve'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject with required reason */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject MPIN Change Request</DialogTitle>
            <DialogDescription>The employee will not be able to change their MPIN until they submit a new request.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">Reason</div>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this request is being rejected"
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(''); }} disabled={isSubmitting}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleReject}
              disabled={isSubmitting || !rejectReason.trim()}
            >
              {isSubmitting ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Rejecting...</> : 'Reject Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
