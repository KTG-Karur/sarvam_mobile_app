'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDateTime } from '@/app/lib/date-format';

type PendingEodRequest = {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  workingDateYmd: string;
  totalAmount: number;
  expectedCashCreditTotal: number;
  difference: number;
  submittedBy: string;
  submittedById: string;
  submittedAt: string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);
}

export function EodApprovalClient() {
  const { toast } = useToast();

  const [items, setItems] = useState<PendingEodRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [activeItem, setActiveItem] = useState<PendingEodRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);

  const loadPending = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await apiClient.get<{ requests: PendingEodRequest[] }>('/eod-close-requests/pending');
      if (result.success && result.data) {
        setItems(result.data.requests ?? []);
        return;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to load pending EOD approvals.',
        variant: 'destructive',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load pending EOD approvals. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(items);

  const approve = async () => {
    if (!activeItem) return;
    setIsApproving(true);
    try {
      const result = await apiClient.post(`/eod-close-requests/${activeItem.id}/approve`);
      if (result.success) {
        toast({ title: 'Approved', description: 'EOD approved — branch working date has advanced.' });
        setActiveItem(null);
        await loadPending();
        return;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to approve EOD.',
        variant: 'destructive',
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to approve EOD. Please try again.', variant: 'destructive' });
    } finally {
      setIsApproving(false);
    }
  };

  const reject = async () => {
    if (!activeItem) return;
    if (!rejectionReason.trim()) {
      toast({ title: 'Reason required', description: 'Enter a reason before rejecting.', variant: 'destructive' });
      return;
    }
    setIsRejecting(true);
    try {
      const result = await apiClient.post(`/eod-close-requests/${activeItem.id}/reject`, {
        rejectionReason: rejectionReason.trim(),
      });
      if (result.success) {
        toast({ title: 'Rejected', description: 'EOD submission sent back to the Branch Manager.' });
        setActiveItem(null);
        setRejectionReason('');
        await loadPending();
        return;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to reject EOD.',
        variant: 'destructive',
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to reject EOD. Please try again.', variant: 'destructive' });
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
          EOD Approval
        </h1>
        <p className="text-muted-foreground">
          Review branch EOD submissions — denomination is auto-calculated from FDO center collections.
          Approving advances the branch&apos;s working date.
        </p>
      </div>

      <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Pending Requests</CardTitle>
              <CardDescription>Branches waiting for EOD approval.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadPending()} disabled={isLoading} className="gap-2">
              <RefreshCw className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-4">
              <TableSearchInput
                value={tableSearchQuery}
                onChange={setTableSearchQuery}
                placeholder="Search pending EOD approvals..."
                className="ml-auto"
              />
            </div>
          )}
          {isLoading && items.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-lg font-semibold">No pending EOD approvals</div>
              <div className="text-sm text-muted-foreground">
                You&apos;re all caught up. New BM submissions will appear here.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead>Working date</TableHead>
                      <TableHead>Denomination total</TableHead>
                      <TableHead>Expected (books)</TableHead>
                      <TableHead>Submitted by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchedRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No pending EOD approvals match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      searchedRows.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.branchName}
                          <div className="text-xs text-muted-foreground">{item.branchCode}</div>
                        </TableCell>
                        <TableCell>{item.workingDateYmd}</TableCell>
                        <TableCell className="font-semibold">{formatMoney(item.totalAmount)}</TableCell>
                        <TableCell>{formatMoney(item.expectedCashCreditTotal)}</TableCell>
                        <TableCell>
                          {item.submittedBy}
                          <div className="text-xs text-muted-foreground">
                            {toDisplayDateTime(new Date(item.submittedAt))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={Math.abs(item.difference) < 0.01 ? 'secondary' : 'destructive'}
                          >
                            {Math.abs(item.difference) < 0.01 ? 'Matches' : `Diff ${formatMoney(item.difference)}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Dialog
                            open={activeItem?.id === item.id}
                            onOpenChange={(open) => {
                              if (!open) {
                                setActiveItem(null);
                                setRejectionReason('');
                              } else {
                                setActiveItem(item);
                                setRejectionReason('');
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button type="button" variant="outline">
                                Review
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg">
                              <DialogHeader>
                                <DialogTitle>Review EOD — {item.branchName}</DialogTitle>
                                <DialogDescription>
                                  Working date {item.workingDateYmd}. Approving advances the branch&apos;s
                                  working date; rejecting sends it back to the BM to fix and resubmit.
                                </DialogDescription>
                              </DialogHeader>

                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                  <div>
                                    <div className="text-muted-foreground">Denomination total</div>
                                    <div className="font-semibold">{formatMoney(item.totalAmount)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Expected (books)</div>
                                    <div className="font-semibold">{formatMoney(item.expectedCashCreditTotal)}</div>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <div className="text-sm font-medium">Rejection reason (required to reject)</div>
                                  <Textarea
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    placeholder="Explain why this EOD submission is being sent back"
                                    rows={3}
                                  />
                                </div>
                              </div>

                              <DialogFooter className="gap-2 sm:gap-3">
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
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
