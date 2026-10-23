'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { CheckCircle2, Filter, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

type Center = { id: string; name: string; code: string };

type PendingForeclosure = {
  id: string;
  status: 'PENDING_APPROVAL';
  createdAt: string;
  initiatedAt: string;
  remarks: string | null;
  amounts: {
    collected: number;
    principal: number;
    interest: number;
    penalty: number;
    fees: number;
  };
  center: Center;
  client: {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    mobileNumber?: string | null;
  };
  loan: {
    id: string;
    loanNumber: string;
    amount: unknown;
    isActive: boolean;
  };
  initiatedBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
};

type PendingResponse = {
  items: PendingForeclosure[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);
}

function statusBadge() {
  return <Badge variant="secondary">Pending</Badge>;
}

type ForeclosureApprovalClientProps = {
  /**
   * When provided, this component is embedded inside another page's own filter bar (Collection
   * Approval's Pre-Close tab — see CollectionApprovalClient.tsx) — its own Branch/Center pickers
   * are hidden and these values drive the query instead, so the page doesn't show two competing
   * Branch/Center filters. Left undefined on the standalone
   * /dashboard/collections/foreclosure-approval page, which keeps its own pickers.
   */
  branchId?: string;
  centerId?: string;
};

export function ForeclosureApprovalClient({ branchId: controlledBranchId, centerId: controlledCenterId }: ForeclosureApprovalClientProps = {}) {
  const isEmbedded = controlledBranchId !== undefined;
  const { canPage } = usePermission();
  // BM can view this list (embedded read-only in the Collection Approval workbench's
  // Pre-Close tab), but approve/reject stays an AM/Admin/Sub Admin-only checker step —
  // a BM is the maker of these requests (see app/api/collections/foreclosure/route.ts),
  // so letting them also approve would remove the maker-checker control. Admin and
  // Sub Admin (Role.isSubAdmin) may approve/reject even a request they initiated
  // themselves — see app/api/foreclosures/[id]/approve|reject/route.ts.
  const storedUser = tokenStorage.getUser();
  const storedUserRole = storedUser?.role;
  const isSubAdmin = !!storedUser?.isSubAdmin;
  const isApproverRole = storedUserRole === 'AREA_MANAGER' || storedUserRole === 'ADMIN' || isSubAdmin;
  const canApproveCollection =
    isApproverRole &&
    (canPage('/dashboard/collections/approval', 'approve') ||
      canPage('/dashboard/collections/foreclosure-approval', 'approve'));
  const { toast } = useToast();

  const [centers, setCenters] = useState<Center[]>([]);
  const [internalCenterId, setInternalCenterId] = useState<string>('all');
  const centerId = isEmbedded ? (controlledCenterId || 'all') : internalCenterId;
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const [items, setItems] = useState<PendingForeclosure[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  const [isBootLoading, setIsBootLoading] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  const [activeItem, setActiveItem] = useState<PendingForeclosure | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState<string>('');
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);

  // Reactive (not memoized-once) — the Admin/AM branch switcher below updates this.
  // Only used when standalone; embedded mode is fully driven by controlledBranchId instead.
  const [internalBranchId, setInternalBranchId] = useState<string | null>(() => {
    const activeBranch = branchStorage.getActiveBranch();
    const storedUser = tokenStorage.getUser();
    return activeBranch?.id || storedUser?.branchId || null;
  });
  const effectiveBranchId = isEmbedded ? (controlledBranchId || null) : internalBranchId;

  const loadCenters = useCallback(async () => {
    if (!effectiveBranchId || isEmbedded) return;
    const result = await apiClient.get<Center[]>(
      `/centers?branchId=${effectiveBranchId}&includeInactive=false&status=APPROVED`
    );
    if (result.success && result.data) {
      setCenters(result.data);
      return;
    }
    setCenters([]);
  }, [effectiveBranchId, isEmbedded]);

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      if (effectiveBranchId) params.set('branchId', effectiveBranchId);
      if (centerId !== 'all') params.set('centerId', centerId);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '20');
      return params.toString();
    },
    [effectiveBranchId, centerId, from, to]
  );

  const loadPage = useCallback(
    async (mode: 'fresh' | 'more') => {
      if (!effectiveBranchId) {
        toast({
          title: 'Error',
          description: 'No branch context found. Please select a branch first.',
          variant: 'destructive',
        });
        return;
      }

      if (mode === 'fresh') setIsLoading(true);
      if (mode === 'more') setIsLoadingMore(true);

      try {
        const query = buildQuery(mode === 'more' ? nextCursor : null);
        const result = await apiClient.get<PendingResponse>(`/foreclosures/pending-approval?${query}`);
        if (!result.success || !result.data) {
          toast({
            title: 'Error',
            description: result.error || 'Failed to load pending preclosures.',
            variant: 'destructive',
          });
          return;
        }

        const responseData = result.data;
        
        if (mode === 'fresh') {
          setItems(responseData.items || []);
        } else {
          setItems((prev) => [...prev, ...(responseData.items || [])]);
        }
        setNextCursor(responseData.page?.nextCursor || null);
        setHasMore(responseData.page?.hasMore || false);
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to load pending preclosures. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [effectiveBranchId, buildQuery, nextCursor, toast]
  );

  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(items);

  const onApplyFilters = async () => {
    setNextCursor(null);
    await loadPage('fresh');
  };

  const onRefresh = async () => {
    setNextCursor(null);
    await loadPage('fresh');
  };

  const onBranchChange = (branch: { id: string }) => {
    setInternalBranchId(branch.id);
    setInternalCenterId('all');
    setNextCursor(null);
    setItems([]);
  };

  // Reload centers + pending list whenever the branch changes (including the initial mount,
  // replacing the old boot-only effect). Also reacts to centerId so embedded mode — which has no
  // local Center picker to pair with a manual "Apply Filters" click — refreshes automatically
  // when the parent's Center filter changes.
  useEffect(() => {
    (async () => {
      setIsBootLoading(true);
      await loadCenters();
      await loadPage('fresh');
      setIsBootLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId, centerId]);

  const approve = async () => {
    if (!activeItem) return;
    setIsApproving(true);
    try {
      const result = await apiClient.post(`/foreclosures/${activeItem.id}/approve`, {
        remarks: decisionRemarks || undefined,
      });
      if (result.success) {
        toast({ title: 'Approved', description: 'Preclosure approved successfully.' });
        setActiveItem(null);
        setDecisionRemarks('');
        await loadPage('fresh');
        return;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to approve preclosure.',
        variant: 'destructive',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to approve preclosure. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsApproving(false);
    }
  };

  const reject = async () => {
    if (!activeItem) return;
    setIsRejecting(true);
    try {
      const result = await apiClient.post(`/foreclosures/${activeItem.id}/reject`, {
        remarks: decisionRemarks || undefined,
      });
      if (result.success) {
        toast({ title: 'Rejected', description: 'Preclosure rejected successfully.' });
        setActiveItem(null);
        setDecisionRemarks('');
        await loadPage('fresh');
        return;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to reject preclosure.',
        variant: 'destructive',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to reject preclosure. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
          Preclosure Approval
        </h1>
        <p className="text-muted-foreground">Review and approve/reject preclosure collections submitted by BM.</p>
      </div>

      <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Pending Requests</CardTitle>
              <CardDescription>Optimized queue view with filters and staged actions.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <TableSearchInput
                value={tableSearchQuery}
                onChange={setTableSearchQuery}
                placeholder="Search pending requests..."
              />
              <Button
                type="button"
                variant="outline"
                onClick={onRefresh}
                disabled={isLoading || isLoadingMore}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          <div className={`grid grid-cols-1 gap-4 ${isEmbedded ? 'md:grid-cols-2' : 'md:grid-cols-4'}`}>
            {!isEmbedded && (
              <LocalBranchFilter value={effectiveBranchId ?? ''} onChange={(id) => onBranchChange({ id })} />
            )}

            {!isEmbedded && (
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  Center
                </div>
                <Select value={centerId} onValueChange={setInternalCenterId} disabled={isBootLoading}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="All centers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All centers</SelectItem>
                    {centers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-sm font-medium">From</div>
              <DateInput
                className="h-11"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={isBootLoading}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">To</div>
              <DateInput
                className="h-11"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={isBootLoading}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              onClick={onApplyFilters}
              disabled={isLoading || isLoadingMore || isBootLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                'Apply Filters'
              )}
            </Button>
          </div>

          {isLoading && items.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : searchedRows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-lg font-semibold">No pending preclosures</div>
              <div className="text-sm text-muted-foreground">
                You’re all caught up. New BM submissions will appear here.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Center</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Loan</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchedRows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.center.name}
                        <div className="text-xs text-muted-foreground">{item.center.code}</div>
                      </TableCell>
                      <TableCell>
                        {item.client.firstName} {item.client.lastName}
                        <div className="text-xs text-muted-foreground">{item.client.clientId}</div>
                      </TableCell>
                      <TableCell>{item.client.mobileNumber || item.client.phone || '—'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.loan.loanNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.loan.isActive ? 'Active' : 'Inactive'}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatMoney(item.amounts.collected)}
                      </TableCell>
                      <TableCell>{statusBadge()}</TableCell>
                      <TableCell className="text-right">
                        <Dialog
                          open={activeItem?.id === item.id}
                          onOpenChange={(open) => {
                            if (!open) {
                              setActiveItem(null);
                              setDecisionRemarks('');
                            } else {
                              setActiveItem(item);
                              setDecisionRemarks('');
                            }
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button type="button" variant="outline">
                              Review
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[90vh] flex flex-col p-0">
                            <DialogHeader className="px-6 py-4 border-b">
                              <DialogTitle>Review Preclosure</DialogTitle>
                              <DialogDescription>
                                Validate the request and choose Approve or Reject.
                              </DialogDescription>
                            </DialogHeader>

                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Card>
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Client</CardTitle>
                                  </CardHeader>
                                  <CardContent className="text-sm space-y-1">
                                    <div className="font-medium">
                                      {item.client.firstName} {item.client.lastName}
                                    </div>
                                    <div className="text-muted-foreground">{item.client.clientId}</div>
                                    {item.client.mobileNumber || item.client.phone ? (
                                      <div className="text-muted-foreground">{item.client.mobileNumber || item.client.phone}</div>
                                    ) : null}
                                  </CardContent>
                                </Card>

                                <Card>
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Loan</CardTitle>
                                  </CardHeader>
                                  <CardContent className="text-sm space-y-1">
                                    <div className="font-medium">{item.loan.loanNumber}</div>
                                    <div className="text-muted-foreground">
                                      Center: {item.center.name} ({item.center.code})
                                    </div>
                                    <div className="text-muted-foreground">
                                      Maker: {item.initiatedBy.firstName} {item.initiatedBy.lastName}
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>

                              <Card>
                                <CardHeader className="pb-2">
                                  <CardTitle className="text-base">Amount Breakdown</CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                                  <div>
                                    <div className="text-muted-foreground">Collected</div>
                                    <div className="font-semibold">{formatMoney(item.amounts.collected)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Principal</div>
                                    <div className="font-medium">{formatMoney(item.amounts.principal)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Interest</div>
                                    <div className="font-medium">{formatMoney(item.amounts.interest)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Penalty</div>
                                    <div className="font-medium">{formatMoney(item.amounts.penalty)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Fees</div>
                                    <div className="font-medium">{formatMoney(item.amounts.fees)}</div>
                                  </div>
                                </CardContent>
                              </Card>

                              {item.remarks ? (
                                <Card>
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base">BM Remarks</CardTitle>
                                  </CardHeader>
                                  <CardContent className="text-sm text-muted-foreground">
                                    {item.remarks}
                                  </CardContent>
                                </Card>
                              ) : null}

                              <div className="space-y-2">
                                <div className="text-sm font-medium">AM Remarks (optional)</div>
                                <Textarea
                                  value={decisionRemarks}
                                  onChange={(e) => setDecisionRemarks(e.target.value)}
                                  placeholder="Add optional remark for audit trail"
                                  rows={3}
                                />
                              </div>
                            </div>

                            <DialogFooter className="px-6 py-4 border-t gap-2 sm:gap-3">
                              {canApproveCollection && (
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={reject}
                                  disabled={isApproving || isRejecting}
                                  className="gap-2"
                                >
                                  {isRejecting ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Rejecting...
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="h-4 w-4" />
                                      Reject
                                    </>
                                  )}
                                </Button>
                              )}
                              {canApproveCollection && (
                                <Button
                                  type="button"
                                  onClick={approve}
                                  disabled={isApproving || isRejecting}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                                >
                                  {isApproving ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Approving...
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="h-4 w-4" />
                                      Approve
                                    </>
                                  )}
                                </Button>
                              )}
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          )}

          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => loadPage('more')}
                disabled={isLoadingMore || isLoading}
                className="gap-2"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Load more
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

