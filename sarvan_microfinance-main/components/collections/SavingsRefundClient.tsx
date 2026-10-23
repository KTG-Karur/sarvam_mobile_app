'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Wallet, RefreshCw, CheckCircle2, XCircle, Plus, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { format } from 'date-fns';
import { tokenStorage } from '@/app/lib/token-storage';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';

type Branch = { id: string; name: string; code: string };
type Center = { id: string; name: string; code: string; branchId?: string };
type ClientLoanAdvanceSummary = {
    clientDbId: string;
    clientId: string;
    clientName: string;
    centerName: string | null;
    centerCode: string | null;
    loanAdvanceBalance: number;
    savingsBalance: number;
    requestedRefundAmount: number;
    availableBalance: number;
    refundStatus: string | null;
    loanId: string | null;
    loanNumber: string | null;
};

type RefundRequest = {
    id: string;
    loanNumber: string;
    clientName: string;
    clientId: string;
    loanAdvanceBalance: number;
    centerName: string;
    totalSavings: number;
    refundAmount: number;
    status: string;
    remarks: string | null;
    initiatedBy: string;
    initiatedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewRemarks: string | null;
};

type PageResponse<T> = {
    data: T[];
    totalCount: number;
    totalPages: number;
    page: number;
    pageSize: number;
};

const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);

const refundStatusBadge = (status: string) => {
    if (status === 'APPROVED') return <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>;
    if (status === 'REJECTED') return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="secondary">Pending Approval</Badge>;
};

export function SavingsRefundClient() {
    const { canPage } = usePermission();
    const { enabled: loanAdvanceEnabled, loading: loanAdvanceEnabledLoading } = useLoanAdvanceEnabled();
    const canCreateCollection  = canPage('/dashboard/collections/savings-refund', 'add');
    const canApproveCollection = canPage('/dashboard/collections/savings-refund', 'approve');
    const { toast } = useToast();

    const storedUser = tokenStorage.getUser();
    const userRole = storedUser?.role ?? '';
    const userBranchId = storedUser?.branchId ?? '';

    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState(
        userRole === 'BRANCH_MANAGER' ? (userBranchId || 'all') : 'all'
    );
    const [selectedCenterId, setSelectedCenterId] = useState('all');
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);

    // Tab 1 — Loan Advance Balances
    const [clientSummaries, setClientSummaries] = useState<ClientLoanAdvanceSummary[]>([]);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [balancesSearch, setBalancesSearch] = useState('');
    const [debouncedBalancesSearch, setDebouncedBalancesSearch] = useState('');
    const [balancesPage, setBalancesPage] = useState(1);
    const [balancesTotalPages, setBalancesTotalPages] = useState(1);
    const [balancesTotalCount, setBalancesTotalCount] = useState(0);
    const [balancesPageSize, setBalancesPageSize] = useState(10);

    // Tab 2 — Refund Requests
    const [requests, setRequests] = useState<RefundRequest[]>([]);
    const [isLoadingRequests, setIsLoadingRequests] = useState(false);
    const [requestsSearch, setRequestsSearch] = useState('');
    const [debouncedRequestsSearch, setDebouncedRequestsSearch] = useState('');
    const [requestsStatusFilter, setRequestsStatusFilter] = useState('PENDING_APPROVAL');
    const [requestsPage, setRequestsPage] = useState(1);
    const [requestsTotalPages, setRequestsTotalPages] = useState(1);
    const [requestsTotalCount, setRequestsTotalCount] = useState(0);
    const [requestsPageSize, setRequestsPageSize] = useState(10);

    const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
    const REQUEST_STATUS_OPTIONS = [
        { value: 'PENDING_APPROVAL', label: 'Pending' },
        { value: 'APPROVED', label: 'Approved' },
        { value: 'REJECTED', label: 'Rejected' },
        { value: 'all', label: 'All' },
    ];

    const [initiateOpen, setInitiateOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<ClientLoanAdvanceSummary | null>(null);
    const [refundAmount, setRefundAmount] = useState('');
    const [remarks, setRemarks] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [approveOpen, setApproveOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<RefundRequest | null>(null);
    const [reviewRemarks, setReviewRemarks] = useState('');
    const [isReviewing, setIsReviewing] = useState(false);

    // Admin and Sub Admin (Role.isSubAdmin) always approve; Area Manager needs the page's approve permission.
    const canApprove = userRole === 'ADMIN' || !!storedUser?.isSubAdmin || (userRole === 'AREA_MANAGER' && canApproveCollection);

    // Debounce search inputs
    useEffect(() => {
        const t = setTimeout(() => setDebouncedBalancesSearch(balancesSearch), 400);
        return () => clearTimeout(t);
    }, [balancesSearch]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedRequestsSearch(requestsSearch), 400);
        return () => clearTimeout(t);
    }, [requestsSearch]);

    const fetchCenters = useCallback(async () => {
        setIsLoadingCenters(true);
        try {
            const result = await apiClient.get<Center[]>('/centers?status=APPROVED');
            if (result.success && result.data) setCenters(result.data);
        } finally {
            setIsLoadingCenters(false);
        }
    }, []);

    const fetchBranches = useCallback(async () => {
        try {
            const res = await fetch('/api/branches');
            if (res.ok) {
                const d = await res.json();
                const list: Branch[] = Array.isArray(d) ? d : (d.data ?? []);

                if (userRole === 'BRANCH_MANAGER' && userBranchId) {
                    // BM sees only their branch
                    setBranches(list.filter(b => b.id === userBranchId));
                } else {
                    setBranches(list);
                }
            }
        } catch {}
    }, [userRole, userBranchId]);

    const fetchClientSummaries = useCallback(async (centerId: string, branchId: string, search: string, pageArg: number, pageSizeArg: number) => {
        if (centerId === 'all' && branchId === 'all') {
            setClientSummaries([]);
            setBalancesTotalPages(1);
            setBalancesTotalCount(0);
            return;
        }
        setIsLoadingClients(true);
        try {
            const params = new URLSearchParams();
            if (centerId !== 'all') params.set('centerId', centerId);
            if (branchId !== 'all') params.set('branchId', branchId);
            if (search) params.set('search', search);
            params.set('page', String(pageArg));
            params.set('pageSize', String(pageSizeArg));
            const result = await apiClient.get<PageResponse<ClientLoanAdvanceSummary>>(`/savings/summary?${params}`);
            if (result.success && result.data) {
                setClientSummaries(result.data.data);
                setBalancesTotalCount(result.data.totalCount);
                setBalancesTotalPages(result.data.totalPages);
                setBalancesPage(result.data.page);
            }
        } finally {
            setIsLoadingClients(false);
        }
    }, []);

    const fetchRequests = useCallback(async (pageArg: number, search: string, pageSizeArg: number, status: string) => {
        setIsLoadingRequests(true);
        try {
            const params = new URLSearchParams({ page: String(pageArg), pageSize: String(pageSizeArg) });
            if (search) params.set('search', search);
            if (status !== 'all') params.set('status', status);
            const result = await apiClient.get<PageResponse<RefundRequest>>(`/savings/refund?${params}`);
            if (result.success && result.data) {
                setRequests(result.data.data);
                setRequestsTotalCount(result.data.totalCount);
                setRequestsTotalPages(result.data.totalPages);
                setRequestsPage(result.data.page);
            }
        } finally {
            setIsLoadingRequests(false);
        }
    }, []);

    const handleRequestsPageChange = (p: number) => {
        fetchRequests(p, debouncedRequestsSearch, requestsPageSize, requestsStatusFilter);
    };

    const handleBalancesPageChange = (p: number) => {
        fetchClientSummaries(selectedCenterId, selectedBranchId, debouncedBalancesSearch, p, balancesPageSize);
    };

    const handleBalancesPageSizeChange = (v: string) => {
        setBalancesPageSize(Number(v));
    };

    const handleRequestsPageSizeChange = (v: string) => {
        setRequestsPageSize(Number(v));
    };

    useEffect(() => { fetchBranches(); fetchCenters(); }, [fetchBranches, fetchCenters]);

    // Centers filtered by selected branch
    const filteredCenters = selectedBranchId === 'all'
        ? centers
        : centers.filter(c => c.branchId === selectedBranchId);

    // When branch changes, reset center
    const handleBranchChange = (v: string) => {
        setSelectedBranchId(v);
        setSelectedCenterId('all');
    };

    useEffect(() => {
        fetchClientSummaries(selectedCenterId, selectedBranchId, debouncedBalancesSearch, 1, balancesPageSize);
    }, [selectedCenterId, selectedBranchId, debouncedBalancesSearch, balancesPageSize, fetchClientSummaries]);

    useEffect(() => {
        fetchRequests(1, debouncedRequestsSearch, requestsPageSize, requestsStatusFilter);
    }, [debouncedRequestsSearch, requestsPageSize, requestsStatusFilter, fetchRequests]);

    const handleInitiate = (client: ClientLoanAdvanceSummary) => {
        setSelectedClient(client);
        setRefundAmount(String(client.availableBalance));
        setRemarks('');
        setInitiateOpen(true);
    };

    const handleSubmitRefund = async () => {
        if (!selectedClient) return;
        const amount = parseFloat(refundAmount);
        if (!amount || amount <= 0) {
            toast({ title: 'Error', description: 'Enter a valid refund amount', variant: 'destructive' });
            return;
        }
        if (amount > selectedClient.availableBalance) {
            toast({ title: 'Error', description: `Amount exceeds available balance (₹${selectedClient.availableBalance})`, variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const result = await apiClient.post('/savings/refund', {
                clientId: selectedClient.clientDbId,
                loanId: selectedClient.loanId || undefined,
                refundAmount: amount,
                remarks: remarks || undefined,
            });
            if (result.success) {
                toast({ title: 'Refund Requested', description: 'Loan advance refund request submitted for approval.' });
                setInitiateOpen(false);
                await Promise.all([
                    fetchClientSummaries(selectedCenterId, selectedBranchId, debouncedBalancesSearch, balancesPage, balancesPageSize),
                    fetchRequests(1, debouncedRequestsSearch, requestsPageSize, requestsStatusFilter),
                ]);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to submit', variant: 'destructive' });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // Balances tab: open the Review dialog for this client's pending refund request.
    const [openingReviewFor, setOpeningReviewFor] = useState<string | null>(null);
    const handleReviewFromBalance = async (c: ClientLoanAdvanceSummary) => {
        setOpeningReviewFor(c.clientDbId);
        try {
            const params = new URLSearchParams({ status: 'PENDING_APPROVAL', clientId: c.clientDbId, pageSize: '1' });
            const result = await apiClient.get<PageResponse<RefundRequest>>(`/savings/refund?${params}`);
            const pending = result.success ? result.data?.data?.[0] : undefined;
            if (!pending) {
                toast({ title: 'Not found', description: result.error || 'No pending refund request found for this client.', variant: 'destructive' });
                return;
            }
            setSelectedRequest(pending);
            setReviewRemarks('');
            setApproveOpen(true);
        } finally {
            setOpeningReviewFor(null);
        }
    };

    const handleReview = async (action: 'APPROVE' | 'REJECT') => {
        if (!selectedRequest) return;
        setIsReviewing(true);
        try {
            const result = await apiClient.put('/savings/refund', {
                id: selectedRequest.id,
                action,
                reviewRemarks: reviewRemarks || undefined,
            });
            if (result.success) {
                toast({ title: action === 'APPROVE' ? 'Approved' : 'Rejected', description: result.message });
                setApproveOpen(false);
                await Promise.all([
                    fetchRequests(requestsPage, debouncedRequestsSearch, requestsPageSize, requestsStatusFilter),
                    fetchClientSummaries(selectedCenterId, selectedBranchId, debouncedBalancesSearch, balancesPage, balancesPageSize),
                ]);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' });
            }
        } finally {
            setIsReviewing(false);
        }
    };

    const statusBadge = (status: string) => {
        if (status === 'APPROVED') return <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>;
        if (status === 'REJECTED') return <Badge variant="destructive">Rejected</Badge>;
        return <Badge variant="secondary">Pending</Badge>;
    };

    if (!loanAdvanceEnabledLoading && !loanAdvanceEnabled) {
        return (
            <div className="space-y-6">
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <Wallet className="mx-auto h-10 w-10 mb-3 text-muted-foreground" />
                        <p className="text-base font-medium">Loan Advance is currently disabled</p>
                        <p className="text-sm mt-1">Ask an Admin to enable it from Hub → Settings to use this feature.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600">
                            <Wallet className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Loan Advance Refund</CardTitle>
                            <p className="text-xs text-muted-foreground">Initiate loan advance refund for clients with collected loan advance balance</p>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <Tabs defaultValue="balances">
                <TabsList>
                    <TabsTrigger value="balances">Loan Advance Balances (Client Wise)</TabsTrigger>
                    <TabsTrigger value="requests">Loan Advance Refund Requests</TabsTrigger>
                </TabsList>

                {/* Tab 1 — Client-wise balances */}
                <TabsContent value="balances">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Loan Advance Balances (Client Wise)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap items-end gap-4 mb-4">
                                {/* Branch filter — locked for BM, dropdown for AM/Admin */}
                                <div className="min-w-[200px] flex-1">
                                    <Label className="text-xs mb-1">Branch</Label>
                                    {userRole === 'BRANCH_MANAGER' ? (
                                        <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                                            {branches[0]?.code ? `${branches[0].code} - ${branches[0].name}` : 'Your Branch'}
                                        </div>
                                    ) : (
                                        <Select value={selectedBranchId} onValueChange={handleBranchChange}>
                                            <SelectTrigger className="h-9">
                                                <SelectValue placeholder="All Branches" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">All Branches</SelectItem>
                                                {branches.map(b => (
                                                    <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>

                                {/* Center filter */}
                                <div className="min-w-[200px] flex-1">
                                    <Label className="text-xs mb-1">Center</Label>
                                    <Select value={selectedCenterId} onValueChange={setSelectedCenterId} disabled={isLoadingCenters}>
                                        <SelectTrigger className="h-9">
                                            <SelectValue placeholder="All Centers" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Centers</SelectItem>
                                            {filteredCenters.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Search */}
                                <div className="relative min-w-[220px] flex-1">
                                    <Label className="text-xs mb-1">Search</Label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Client name or ID..."
                                            value={balancesSearch}
                                            onChange={(e) => setBalancesSearch(e.target.value)}
                                            className="h-9 pl-9"
                                        />
                                    </div>
                                </div>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fetchClientSummaries(selectedCenterId, selectedBranchId, debouncedBalancesSearch, balancesPage, balancesPageSize)}
                                    disabled={isLoadingClients}
                                >
                                    <RefreshCw className={`h-4 w-4 ${isLoadingClients ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>

                            {selectedCenterId === 'all' && selectedBranchId === 'all' ? (
                                <p className="text-sm text-muted-foreground text-center py-6">Select a branch or center to view loan advance balances.</p>
                            ) : isLoadingClients ? (
                                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                            ) : clientSummaries.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-6">No loan advance balances found.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>#</TableHead>
                                                <TableHead>Client</TableHead>
                                                <TableHead>Client ID</TableHead>
                                                <TableHead>Center</TableHead>
                                                <TableHead className="text-right">Loan Advance Balance</TableHead>
                                                <TableHead className="text-right">Requested Refund Amount</TableHead>
                                                <TableHead className="text-right">Available Balance</TableHead>
                                                <TableHead>Refund Status</TableHead>
                                                <TableHead className="text-center">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {clientSummaries.map((c, i) => (
                                                <TableRow key={c.clientDbId}>
                                                    <TableCell className="text-xs">{(balancesPage - 1) * balancesPageSize + i + 1}</TableCell>
                                                    <TableCell>
                                                        <p className="font-medium text-sm">{c.clientName}</p>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{c.clientId}</TableCell>
                                                    <TableCell className="text-xs">{c.centerName ? `${c.centerName}${c.centerCode ? ` (${c.centerCode})` : ''}` : '—'}</TableCell>
                                                    <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(c.loanAdvanceBalance)}</TableCell>
                                                    <TableCell className="text-right text-xs">{c.requestedRefundAmount > 0 ? formatCurrency(c.requestedRefundAmount) : '—'}</TableCell>
                                                    <TableCell className="text-right text-xs">{formatCurrency(c.availableBalance)}</TableCell>
                                                    <TableCell>{c.refundStatus ? refundStatusBadge(c.refundStatus) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                                                    <TableCell className="text-center">
                                                        {canCreateCollection && !c.refundStatus && c.availableBalance > 0 && (
                                                            <Button size="sm" variant="outline" onClick={() => handleInitiate(c)}>
                                                                <Plus className="h-3 w-3 mr-1" /> Initiate Refund
                                                            </Button>
                                                        )}
                                                        {canApprove && c.refundStatus === 'PENDING_APPROVAL' && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={openingReviewFor === c.clientDbId}
                                                                onClick={() => handleReviewFromBalance(c)}
                                                            >
                                                                {openingReviewFor === c.clientDbId ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                                                                Review
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}

                            {balancesTotalCount > 0 && (
                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Page {balancesPage} of {balancesTotalPages} · {balancesTotalCount} record{balancesTotalCount !== 1 ? 's' : ''}
                                        </p>
                                        <Select value={String(balancesPageSize)} onValueChange={handleBalancesPageSizeChange}>
                                            <SelectTrigger className="h-8 w-[110px] text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {PAGE_SIZE_OPTIONS.map((size) => (
                                                    <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {balancesTotalPages > 1 && (
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="sm" onClick={() => handleBalancesPageChange(Math.max(1, balancesPage - 1))} disabled={balancesPage === 1 || isLoadingClients}>
                                                Previous
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleBalancesPageChange(Math.min(balancesTotalPages, balancesPage + 1))} disabled={balancesPage === balancesTotalPages || isLoadingClients}>
                                                Next
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Tab 2 — Refund requests */}
                <TabsContent value="requests">
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-4">
                                <CardTitle className="text-base">Loan Advance Refund Requests</CardTitle>
                                <Button variant="outline" size="sm" onClick={() => fetchRequests(requestsPage, debouncedRequestsSearch, requestsPageSize, requestsStatusFilter)} disabled={isLoadingRequests}>
                                    <RefreshCw className={`h-4 w-4 ${isLoadingRequests ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap items-end gap-4 mb-4">
                                <div className="relative min-w-[220px] flex-1 max-w-sm">
                                    <Label className="text-xs mb-1">Search</Label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Client name, ID or loan number..."
                                            value={requestsSearch}
                                            onChange={(e) => setRequestsSearch(e.target.value)}
                                            className="pl-9"
                                        />
                                    </div>
                                </div>
                                <div className="min-w-[160px]">
                                    <Label className="text-xs mb-1">Status</Label>
                                    <Select value={requestsStatusFilter} onValueChange={setRequestsStatusFilter}>
                                        <SelectTrigger className="h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {REQUEST_STATUS_OPTIONS.map((o) => (
                                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {isLoadingRequests ? (
                                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                            ) : requests.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-6">No refund requests found.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Client</TableHead>
                                                <TableHead>Client ID</TableHead>
                                                <TableHead>Center</TableHead>
                                                <TableHead className="text-right">Total Loan Advance</TableHead>
                                                <TableHead className="text-right">Refund Amt</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Initiated By</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Reviewed By</TableHead>
                                                {canApprove && <TableHead className="text-center">Action</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {requests.map((r) => (
                                                <TableRow key={r.id}>
                                                    <TableCell className="text-sm">{r.clientName}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{r.clientId}</TableCell>
                                                    <TableCell className="text-xs">{r.centerName}</TableCell>
                                                    <TableCell className="text-right text-xs">{formatCurrency(r.totalSavings)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(r.refundAmount)}</TableCell>
                                                    <TableCell>{statusBadge(r.status)}</TableCell>
                                                    <TableCell className="text-xs">{r.initiatedBy}</TableCell>
                                                    <TableCell className="text-xs">{format(new Date(r.initiatedAt), 'dd/MM/yyyy')}</TableCell>
                                                    <TableCell className="text-xs">
                                                        {r.reviewedBy ? (
                                                            <>
                                                                <p>{r.reviewedBy}</p>
                                                                {r.reviewedAt && (
                                                                    <p className="text-muted-foreground">{format(new Date(r.reviewedAt), 'dd/MM/yyyy')}</p>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>
                                                    {canApprove && (
                                                        <TableCell className="text-center">
                                                            {r.status === 'PENDING_APPROVAL' && (
                                                                <Button size="sm" variant="outline" onClick={() => { setSelectedRequest(r); setReviewRemarks(''); setApproveOpen(true); }}>
                                                                    Review
                                                                </Button>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                            {requestsTotalCount > 0 && (
                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Page {requestsPage} of {requestsTotalPages} · {requestsTotalCount} record{requestsTotalCount !== 1 ? 's' : ''}
                                        </p>
                                        <Select value={String(requestsPageSize)} onValueChange={handleRequestsPageSizeChange}>
                                            <SelectTrigger className="h-8 w-[110px] text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {PAGE_SIZE_OPTIONS.map((size) => (
                                                    <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {requestsTotalPages > 1 && (
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="sm" onClick={() => handleRequestsPageChange(Math.max(1, requestsPage - 1))} disabled={requestsPage === 1 || isLoadingRequests}>
                                                Previous
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleRequestsPageChange(Math.min(requestsTotalPages, requestsPage + 1))} disabled={requestsPage === requestsTotalPages || isLoadingRequests}>
                                                Next
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Initiate Refund Dialog */}
            <Dialog open={initiateOpen} onOpenChange={setInitiateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Initiate Loan Advance Refund</DialogTitle>
                    </DialogHeader>
                    {selectedClient && (
                        <div className="space-y-4 py-2">
                            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
                                <p><span className="text-muted-foreground">Client:</span> <span className="font-medium">{selectedClient.clientName}</span></p>
                                <p><span className="text-muted-foreground">Client ID:</span> <span className="font-mono text-xs">{selectedClient.clientId}</span></p>
                                <p><span className="text-muted-foreground">Loan Advance Balance:</span> <span className="font-semibold text-emerald-600">{formatCurrency(selectedClient.loanAdvanceBalance)}</span></p>
                                <p><span className="text-muted-foreground">Available Balance:</span> <span className="font-semibold">{formatCurrency(selectedClient.availableBalance)}</span></p>
                            </div>
                            <div>
                                <Label className="text-xs">Refund Amount <span className="text-rose-500">*</span></Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={selectedClient.availableBalance}
                                    value={refundAmount}
                                    onChange={(e) => setRefundAmount(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-xs">Remarks</Label>
                                <Input
                                    value={remarks}
                                    onChange={(e) => setRemarks(e.target.value)}
                                    placeholder="Optional remarks..."
                                    className="mt-1"
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setInitiateOpen(false)} disabled={isSubmitting}>Cancel</Button>
                        <Button onClick={handleSubmitRefund} disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-700">
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Submit for Approval
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Approve/Reject Dialog */}
            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Review Loan Advance Refund Request</DialogTitle>
                    </DialogHeader>
                    {selectedRequest && (
                        <div className="space-y-4 py-2">
                            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
                                <p><span className="text-muted-foreground">Client:</span> <span className="font-medium">{selectedRequest.clientName}</span></p>
                                <p><span className="text-muted-foreground">Total Loan Advance:</span> <span className="text-xs">{formatCurrency(selectedRequest.totalSavings)}</span></p>
                                <p><span className="text-muted-foreground">Refund Amount:</span> <span className="font-semibold text-emerald-600">{formatCurrency(selectedRequest.refundAmount)}</span></p>
                                <p><span className="text-muted-foreground">Remarks:</span> {selectedRequest.remarks || '—'}</p>
                                <p><span className="text-muted-foreground">Initiated By:</span> {selectedRequest.initiatedBy}</p>
                            </div>
                            <div>
                                <Label className="text-xs">Review Remarks</Label>
                                <Input
                                    value={reviewRemarks}
                                    onChange={(e) => setReviewRemarks(e.target.value)}
                                    placeholder="Optional remarks..."
                                    className="mt-1"
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={isReviewing}>Cancel</Button>
                        <Button variant="destructive" onClick={() => handleReview('REJECT')} disabled={isReviewing}>
                            {isReviewing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                            Reject
                        </Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleReview('APPROVE')} disabled={isReviewing}>
                            {isReviewing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            Approve
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
