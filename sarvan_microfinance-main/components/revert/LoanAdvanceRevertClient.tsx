'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, Undo2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { RevertReasonDialog } from '@/components/revert/RevertReasonDialog';
import type { RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { DateInput } from '@/components/ui/date-input';

type Branch = { id: string; name: string; code: string };

interface SavingsCollectionRow {
    transactionId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    amount: number;
    transactionDate: string;
    eligible: boolean;
    ineligibleReason?: 'LATER_ACTIVITY' | 'EOD_LOCKED' | 'ALLOCATED' | null;
}

interface RevertedSavingsCollectionRow {
    transactionId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    amount: number;
    transactionDate: string;
    revertedAt: string | null;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
}

interface SavingsRefundRow {
    requestId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    refundAmount: number;
    reviewedAt: string;
    eligible: boolean;
}

interface RevertedSavingsRefundRow {
    requestId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    refundAmount: number;
    reviewedAt: string;
    revertedAt: string | null;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
}

export function LoanAdvanceRevertClient() {
    const { toast } = useToast();
    const { enabled: loanAdvanceEnabled, loading: loanAdvanceEnabledLoading } = useLoanAdvanceEnabled();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

    const [collectionRows, setCollectionRows] = useState<SavingsCollectionRow[]>([]);
    const [revertedCollectionRows, setRevertedCollectionRows] = useState<RevertedSavingsCollectionRow[]>([]);
    const [isLoadingCollections, setIsLoadingCollections] = useState(false);
    const [showRevertedCollections, setShowRevertedCollections] = useState(false);
    const [refundRows, setRefundRows] = useState<SavingsRefundRow[]>([]);
    const [revertedRefundRows, setRevertedRefundRows] = useState<RevertedSavingsRefundRow[]>([]);
    const [isLoadingRefunds, setIsLoadingRefunds] = useState(false);
    const [showRevertedRefunds, setShowRevertedRefunds] = useState(false);

    const [selectedCollection, setSelectedCollection] = useState<SavingsCollectionRow | null>(null);
    const [selectedRefund, setSelectedRefund] = useState<SavingsRefundRow | null>(null);
    const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
    const [refundDialogOpen, setRefundDialogOpen] = useState(false);
    const [isReverting, setIsReverting] = useState(false);

    // This page is Admin-only (see server-route-protection.ts), so there is no
    // BM/AM "single active branch" case to special-case here — always fetch
    // the full branch list. Reading tokenStorage/branchStorage synchronously in
    // the render body would differ between SSR (no localStorage) and the client,
    // so it stays confined to this effect to avoid a hydration mismatch.
    useEffect(() => {
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                const list: Branch[] = (json?.data ?? []).map((b: Branch) => ({ id: b.id, name: b.name, code: b.code }));
                setBranches(list);
            })
            .catch(() => toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' }))
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchCollections = async () => {
        if (!branchId || !date) return;
        try {
            setIsLoadingCollections(true);
            if (showRevertedCollections) {
                const response = await apiClient.get<RevertedSavingsCollectionRow[]>(
                    `/collections/savings/revert?branchId=${branchId}&date=${date}&status=reverted`
                );
                setRevertedCollectionRows(response.success && Array.isArray(response.data) ? response.data : []);
            } else {
                const response = await apiClient.get<SavingsCollectionRow[]>(
                    `/collections/savings/revert?branchId=${branchId}&date=${date}`
                );
                setCollectionRows(response.success && Array.isArray(response.data) ? response.data : []);
            }
        } catch (error) {
            console.error('Error fetching savings collections:', error);
            setCollectionRows([]);
            setRevertedCollectionRows([]);
        } finally {
            setIsLoadingCollections(false);
        }
    };

    const fetchRefunds = async () => {
        if (!branchId) return;
        try {
            setIsLoadingRefunds(true);
            if (showRevertedRefunds) {
                const response = await apiClient.get<RevertedSavingsRefundRow[]>(`/savings/refund/revert?branchId=${branchId}&status=reverted`);
                setRevertedRefundRows(response.success && Array.isArray(response.data) ? response.data : []);
            } else {
                const response = await apiClient.get<SavingsRefundRow[]>(`/savings/refund/revert?branchId=${branchId}`);
                setRefundRows(response.success && Array.isArray(response.data) ? response.data : []);
            }
        } catch (error) {
            console.error('Error fetching savings refunds:', error);
            setRefundRows([]);
            setRevertedRefundRows([]);
        } finally {
            setIsLoadingRefunds(false);
        }
    };

    useEffect(() => {
        if (branchId) {
            fetchCollections();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, date, showRevertedCollections]);

    useEffect(() => {
        if (branchId) {
            fetchRefunds();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, date, showRevertedRefunds]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(collectionRows);
    const { query: tableSearchQuery2, setQuery: setTableSearchQuery2, filtered: searchedRows2 } = useTableSearch(revertedCollectionRows);
    const { query: tableSearchQuery3, setQuery: setTableSearchQuery3, filtered: searchedRows3 } = useTableSearch(refundRows);
    const { query: tableSearchQuery4, setQuery: setTableSearchQuery4, filtered: searchedRows4 } = useTableSearch(revertedRefundRows);

    const handleRevertCollection = async (reason: string, location: RevertLocationValue | null) => {
        if (!selectedCollection || !location) return;
        try {
            setIsReverting(true);
            const response = await apiClient.post('/collections/savings/revert', {
                transactionId: selectedCollection.transactionId,
                reason,
                latitude: location.latitude,
                longitude: location.longitude,
            });
            if (response.success) {
                toast({ title: 'Success', description: 'Loan advance collection reverted successfully' });
                setCollectionDialogOpen(false);
                setSelectedCollection(null);
                // Re-fetch rather than just removing this row — reverting it may have
                // just made an older, previously-blocked row on the same loan eligible.
                await fetchCollections();
            } else {
                toast({ title: 'Error', description: response.message || 'Failed to revert', variant: 'destructive' });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to revert loan advance collection';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    const handleRevertRefund = async (reason: string, location: RevertLocationValue | null) => {
        if (!selectedRefund || !location) return;
        try {
            setIsReverting(true);
            const response = await apiClient.post('/savings/refund/revert', {
                requestId: selectedRefund.requestId,
                reason,
                latitude: location.latitude,
                longitude: location.longitude,
            });
            if (response.success) {
                toast({ title: 'Success', description: 'Loan advance refund reverted successfully' });
                setRefundDialogOpen(false);
                setSelectedRefund(null);
                // Re-fetch rather than just removing this row — reverting it may have
                // just made an older, previously-blocked row on the same loan eligible.
                await fetchRefunds();
            } else {
                toast({ title: 'Error', description: response.message || 'Failed to revert', variant: 'destructive' });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to revert loan advance refund';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    if (!loanAdvanceEnabledLoading && !loanAdvanceEnabled) {
        return (
            <div className="space-y-6">
                <div className="flex flex-col gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                        Loan Advance Revert
                    </h1>
                </div>
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p className="text-base font-medium">Loan Advance is currently disabled</p>
                        <p className="text-sm mt-1">Ask an Admin to enable it from Hub → Settings to use this page.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Loan Advance Revert
                </h1>
                <p className="text-muted-foreground">
                    Undo a loan advance collection or refund
                </p>
            </div>

            <Alert variant="destructive" className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> Only the most recent un-reversed loan advance collection or refund for a
                    loan can be reverted — reverting out of order would leave a later transaction unbacked. Also
                    blocked once EOD has been processed past the transaction&apos;s date. Rows marked ineligible must
                    wait until the later one is reverted, or can no longer be reverted once EOD has moved past.
                </AlertDescription>
            </Alert>

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row gap-3">
                        {isLoadingBranches ? (
                            <div className="flex items-center h-11 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading branches...
                            </div>
                        ) : (
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger className="h-11 sm:w-64">
                                    <SelectValue placeholder="-- SELECT BRANCH --" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <DateInput
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="h-11 sm:w-56"
                        />
                    </div>
                </CardContent>
            </Card>

            <Tabs defaultValue="collections">
                <TabsList>
                    <TabsTrigger value="collections">Loan Advance Collection Revert</TabsTrigger>
                    <TabsTrigger value="refunds">Loan Advance Refund Revert</TabsTrigger>
                </TabsList>

                <TabsContent value="collections">
                    <Card className="border-2 shadow-xl overflow-hidden">
                        <CardHeader>
                            <CardTitle>Loan Advance Collections</CardTitle>
                            <CardDescription>
                                {showRevertedCollections
                                    ? 'Reverted loan advance collections for the selected branch/date'
                                    : 'Approved loan advance collections for the selected branch/date'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3 border-b pb-4">
                                <Switch checked={showRevertedCollections} onCheckedChange={setShowRevertedCollections} />
                                <div>
                                    <p className="text-sm font-semibold">Show Reverted Collections</p>
                                    <p className="text-xs text-muted-foreground">
                                        {showRevertedCollections
                                            ? 'Viewing reverted collections — showing who reverted each one and when.'
                                            : 'Off shows revertible collections. Turn on to view the reverted history instead.'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                                {showRevertedCollections ? (
                                    <TableSearchInput
                                        value={tableSearchQuery2}
                                        onChange={setTableSearchQuery2}
                                        placeholder="Search reverted collections..."
                                        className="ml-auto"
                                    />
                                ) : (
                                    <TableSearchInput
                                        value={tableSearchQuery}
                                        onChange={setTableSearchQuery}
                                        placeholder="Search collections..."
                                        className="ml-auto"
                                    />
                                )}
                            </div>

                            {isLoadingCollections ? (
                                <PageLoader fullScreen={false} />
                            ) : showRevertedCollections ? (
                                searchedRows2.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">No reverted loan advance collections found.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Loan No.</TableHead>
                                                    <TableHead>Member</TableHead>
                                                    <TableHead>Amount</TableHead>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead>Reverted By</TableHead>
                                                    <TableHead>Reverted On</TableHead>
                                                    <TableHead>Revert Reason</TableHead>
                                                    <TableHead>Revert Location</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {searchedRows2.map((row) => (
                                                    <TableRow key={row.transactionId}>
                                                        <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                        <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                        <TableCell>₹{row.amount.toFixed(2)}</TableCell>
                                                        <TableCell>{format(new Date(row.transactionDate), 'dd/MM/yyyy')}</TableCell>
                                                        <TableCell className="text-xs">
                                                            {row.revertedByName ?? '-'}
                                                            {row.revertedByEmployeeId && (
                                                                <span className="block text-muted-foreground">({row.revertedByEmployeeId})</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-xs">
                                                            {row.revertedAt ? format(new Date(row.revertedAt), 'dd/MM/yyyy hh:mm a') : '-'}
                                                        </TableCell>
                                                        <TableCell className="text-xs max-w-[220px] whitespace-pre-wrap break-words">
                                                            {row.revertReason ?? '-'}
                                                        </TableCell>
                                                        <TableCell className="text-xs">
                                                            <RevertLocationCell location={row.revertLocation} />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )
                            ) : searchedRows.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">No loan advance collections found.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Loan No.</TableHead>
                                                <TableHead>Member</TableHead>
                                                <TableHead>Amount</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {searchedRows.map((row) => (
                                                <TableRow key={row.transactionId}>
                                                    <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                    <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                    <TableCell>₹{row.amount.toFixed(2)}</TableCell>
                                                    <TableCell>{format(new Date(row.transactionDate), 'dd/MM/yyyy')}</TableCell>
                                                    <TableCell>
                                                        {row.eligible ? (
                                                            <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">Eligible</Badge>
                                                        ) : row.ineligibleReason === 'EOD_LOCKED' ? (
                                                            <Badge variant="outline" className="border-slate-400 text-slate-600 dark:text-slate-400">
                                                                EOD locked
                                                            </Badge>
                                                        ) : row.ineligibleReason === 'ALLOCATED' ? (
                                                            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                                                Allocated — revert allocation first
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                                                Later txn exists
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            disabled={!row.eligible}
                                                            onClick={() => { setSelectedCollection(row); setCollectionDialogOpen(true); }}
                                                        >
                                                            <Undo2 className="h-4 w-4 mr-1" /> Revert
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="refunds">
                    <Card className="border-2 shadow-xl overflow-hidden">
                        <CardHeader>
                            <CardTitle>Loan Advance Refunds</CardTitle>
                            <CardDescription>
                                {showRevertedRefunds
                                    ? 'Reverted loan advance refunds for the selected branch'
                                    : 'Approved loan advance refunds for the selected branch'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3 border-b pb-4">
                                <Switch checked={showRevertedRefunds} onCheckedChange={setShowRevertedRefunds} />
                                <div>
                                    <p className="text-sm font-semibold">Show Reverted Refunds</p>
                                    <p className="text-xs text-muted-foreground">
                                        {showRevertedRefunds
                                            ? 'Viewing reverted refunds — showing who reverted each one and when.'
                                            : 'Off shows revertible refunds. Turn on to view the reverted history instead.'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                                {showRevertedRefunds ? (
                                    <TableSearchInput
                                        value={tableSearchQuery4}
                                        onChange={setTableSearchQuery4}
                                        placeholder="Search reverted refunds..."
                                        className="ml-auto"
                                    />
                                ) : (
                                    <TableSearchInput
                                        value={tableSearchQuery3}
                                        onChange={setTableSearchQuery3}
                                        placeholder="Search refunds..."
                                        className="ml-auto"
                                    />
                                )}
                            </div>

                            {isLoadingRefunds ? (
                                <PageLoader fullScreen={false} />
                            ) : showRevertedRefunds ? (
                                searchedRows4.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">No reverted loan advance refunds found.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Loan No.</TableHead>
                                                    <TableHead>Member</TableHead>
                                                    <TableHead>Refund Amount</TableHead>
                                                    <TableHead>Approved At</TableHead>
                                                    <TableHead>Reverted By</TableHead>
                                                    <TableHead>Reverted On</TableHead>
                                                    <TableHead>Revert Reason</TableHead>
                                                    <TableHead>Revert Location</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {searchedRows4.map((row) => (
                                                    <TableRow key={row.requestId}>
                                                        <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                        <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                        <TableCell>₹{row.refundAmount.toFixed(2)}</TableCell>
                                                        <TableCell>{row.reviewedAt ? format(new Date(row.reviewedAt), 'dd/MM/yyyy hh:mm a') : '-'}</TableCell>
                                                        <TableCell className="text-xs">
                                                            {row.revertedByName ?? '-'}
                                                            {row.revertedByEmployeeId && (
                                                                <span className="block text-muted-foreground">({row.revertedByEmployeeId})</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-xs">
                                                            {row.revertedAt ? format(new Date(row.revertedAt), 'dd/MM/yyyy hh:mm a') : '-'}
                                                        </TableCell>
                                                        <TableCell className="text-xs max-w-[220px] whitespace-pre-wrap break-words">
                                                            {row.revertReason ?? '-'}
                                                        </TableCell>
                                                        <TableCell className="text-xs">
                                                            <RevertLocationCell location={row.revertLocation} />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )
                            ) : searchedRows3.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">No loan advance refunds found.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Loan No.</TableHead>
                                                <TableHead>Member</TableHead>
                                                <TableHead>Refund Amount</TableHead>
                                                <TableHead>Approved At</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {searchedRows3.map((row) => (
                                                <TableRow key={row.requestId}>
                                                    <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                    <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                    <TableCell>₹{row.refundAmount.toFixed(2)}</TableCell>
                                                    <TableCell>{format(new Date(row.reviewedAt), 'dd/MM/yyyy hh:mm a')}</TableCell>
                                                    <TableCell>
                                                        {row.eligible ? (
                                                            <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">Eligible</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                                                Later txn exists
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            disabled={!row.eligible}
                                                            onClick={() => { setSelectedRefund(row); setRefundDialogOpen(true); }}
                                                        >
                                                            <Undo2 className="h-4 w-4 mr-1" /> Revert
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <RevertReasonDialog
                open={collectionDialogOpen}
                onOpenChange={(open) => { setCollectionDialogOpen(open); if (!open) setSelectedCollection(null); }}
                title="Revert Loan Advance Collection"
                description={selectedCollection ? `Revert the loan advance collection of ₹${selectedCollection.amount.toFixed(2)} for ${selectedCollection.memberName} (${selectedCollection.loanNumber})?` : ''}
                isSubmitting={isReverting}
                onConfirm={handleRevertCollection}
            />

            <RevertReasonDialog
                open={refundDialogOpen}
                onOpenChange={(open) => { setRefundDialogOpen(open); if (!open) setSelectedRefund(null); }}
                title="Revert Loan Advance Refund"
                description={selectedRefund ? `Revert the loan advance refund of ₹${selectedRefund.refundAmount.toFixed(2)} for ${selectedRefund.memberName} (${selectedRefund.loanNumber})?` : ''}
                isSubmitting={isReverting}
                onConfirm={handleRevertRefund}
            />
        </div>
    );
}
