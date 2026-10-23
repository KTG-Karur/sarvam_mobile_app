'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    CheckCircle2,
    AlertCircle,
    Users,
    Banknote,
    ShieldCheck,
    ShieldX,
    Check,
    ChevronDown,
    ChevronUp,
    Filter,
    Pencil,
    Eye,
    ShieldAlert,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { LoanProductEditModal, type UpdatedLoanProduct } from '@/components/loan-module/LoanProductEditModal';
import { MemberVerificationDialog } from '@/components/loan-module/MemberVerificationDialog';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type Branch = { id: string; name: string; code: string };

type PendingLoan = {
    id: string;
    amount: number;
    maxAllowedAmount: number;
    interestRate: number;
    tenureMonths: number;
    frequency: string;
    loanProductId: string | null;
    clientName: string;
    clientId: string;
    clientDbId: string;
    purpose: string;
    purposeType: string;
    tenure: string;
    isVerified: boolean;
};

type PendingIndex = {
    id: string;
    indexNo: string;
    indexDate: string;
    centerId: string;
    centerName: string;
    centerCode: string;
    totalAmount: number;
    totalLoans: number;
    loans: PendingLoan[];
};

function getTodayStr(): string {
    return new Date().toISOString().split('T')[0];
}

export function DisbursementClient() {
    const { canPage } = usePermission();
    const canApproveLoan = canPage('/dashboard/loan-module/disbursement', 'approve');
    const { toast } = useToast();

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userRole, setUserRole] = useState<string>('');

    // Filter state
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    // AM state
    const [amStats, setAmStats] = useState({ totalClients: 0, totalAmount: 0 });
    const [pendingIndexes, setPendingIndexes] = useState<PendingIndex[]>([]);
    const [amExpandedIndexId, setAmExpandedIndexId] = useState<string | null>(null);
    const [selectedPendingIndexIds, setSelectedPendingIndexIds] = useState<string[]>([]);
    const [isPendingSelectAll, setIsPendingSelectAll] = useState(false);
    const [amActionDialogOpen, setAmActionDialogOpen] = useState(false);
    const [amPendingAction, setAmPendingAction] = useState<'APPROVE' | 'REJECT' | null>(null);
    const [detailsReviewOpen, setDetailsReviewOpen] = useState(false);
    const [detailsAcknowledged, setDetailsAcknowledged] = useState(false);
    const [ongoingLoansData, setOngoingLoansData] = useState<Array<{ clientId: string; clientName: string; loans: any[]; duplicatesInBatch: any[] }>>([]);
    const [isLoadingOngoingLoans, setIsLoadingOngoingLoans] = useState(false);
    const [isFetchingPending, setIsFetchingPending] = useState(false);
    const [editingLoan, setEditingLoan] = useState<PendingLoan | null>(null);
    const [verifyingLoanId, setVerifyingLoanId] = useState<string | null>(null);
    // Per-member reject: sends one loan back to Loan Indexation (rest of the index stays)
    const [rejectingLoan, setRejectingLoan] = useState<{ loan: PendingLoan; indexNo: string } | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [isRejectingLoan, setIsRejectingLoan] = useState(false);

    useEffect(() => {
        const storedUser = tokenStorage.getUser();
        setUserRole(storedUser?.role || '');
        fetchBranches();
    }, []);

    const fetchBranches = async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<Branch[]>('/branches?includeInactive=false');
            if (result.success && result.data) {
                let list = result.data;
                const storedUser = tokenStorage.getUser();
                if (storedUser?.role === 'AREA_MANAGER') {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load branches.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchAMStats = useCallback(async (branchId: string, from: string, to: string) => {
        if (!branchId) return;
        setIsFetchingPending(true);
        try {
            const params = new URLSearchParams({ branchId, fromDate: from, toDate: to });
            const result = await apiClient.get<any>(`/disbursements/pending-level2-details?${params}`);
            if (result.success && result.data) {
                setAmStats(result.data.stats || { totalClients: 0, totalAmount: 0 });
                setPendingIndexes(result.data.indexes || []);
            } else {
                setAmStats({ totalClients: 0, totalAmount: 0 });
                setPendingIndexes([]);
            }
            setSelectedPendingIndexIds([]);
            setIsPendingSelectAll(false);
            setDetailsAcknowledged(false);
        } catch (error) {
            console.error('[AM] Error fetching stats:', error);
        } finally {
            setIsFetchingPending(false);
        }
    }, []);

    const handleBranchChange = (branchId: string) => {
        setSelectedBranchId(branchId);
        fetchAMStats(branchId, fromDate, toDate);
    };

    const handleFromDateChange = (val: string) => {
        setFromDate(val);
        if (selectedBranchId) fetchAMStats(selectedBranchId, val, toDate);
    };

    const handleToDateChange = (val: string) => {
        setToDate(val);
        if (selectedBranchId) fetchAMStats(selectedBranchId, fromDate, val);
    };

    const toggleSelectAllPending = (checked: boolean) => {
        setIsPendingSelectAll(checked);
        setSelectedPendingIndexIds(checked ? pendingIndexes.map((p) => p.id) : []);
        setDetailsAcknowledged(false);
    };

    const togglePendingIndex = (indexId: string, checked: boolean) => {
        setSelectedPendingIndexIds((prev) => {
            const next = checked ? [...prev, indexId] : prev.filter((id) => id !== indexId);
            const allIds = pendingIndexes.map((p) => p.id);
            setIsPendingSelectAll(allIds.length > 0 && allIds.every((id) => next.includes(id)));
            return next;
        });
        setDetailsAcknowledged(false);
    };

    const openAMActionDialog = (action: 'APPROVE' | 'REJECT') => {
        if (selectedPendingIndexIds.length === 0) {
            toast({ title: 'No Selection', description: 'Select at least one index batch.', variant: 'destructive' });
            return;
        }
        // Member Individual + GRT must be complete for every client before AM
        // can approve — mirrors the server-side gate in level2-action, surfaced
        // here so the AM doesn't hit an error after clicking Approve.
        if (action === 'APPROVE') {
            const unverifiedNames = pendingIndexes
                .filter((idx) => selectedPendingIndexIds.includes(idx.id))
                .flatMap((idx) => idx.loans.filter((l) => !l.isVerified).map((l) => l.clientName));
            if (unverifiedNames.length > 0) {
                toast({
                    title: 'Complete Member Individual & GRT first',
                    description: `Cannot approve — pending for: ${unverifiedNames.join(', ')}. Use the Verify (eye) icon to check status.`,
                    variant: 'destructive',
                });
                return;
            }
        }
        setAmPendingAction(action);
        setAmActionDialogOpen(true);
    };

    const fetchOngoingLoansForSelectedIndexes = async () => {
        if (selectedPendingIndexIds.length === 0) return;

        setIsLoadingOngoingLoans(true);
        try {
            const selectedIndexes = pendingIndexes.filter((idx) => selectedPendingIndexIds.includes(idx.id));
            const allClients = new Map<string, { dbId: string; displayId: string; name: string }>();
            const loansBeingProcessed = new Set<string>();
            // Loans for the SAME client that are both sitting in the current selection
            // (across one or more index batches) — a duplicate loan awaiting approval
            // right now, distinct from a client's other already-ongoing loans elsewhere.
            const loansInSelectionByClient = new Map<string, Array<{ indexNo: string; purpose: string; amount: number; frequency: string }>>();

            selectedIndexes.forEach((idx) => {
                idx.loans.forEach((loan) => {
                    if (!allClients.has(loan.clientDbId)) {
                        allClients.set(loan.clientDbId, {
                            dbId: loan.clientDbId,
                            displayId: loan.clientId,
                            name: loan.clientName,
                        });
                    }
                    loansBeingProcessed.add(loan.id);

                    if (!loansInSelectionByClient.has(loan.clientDbId)) {
                        loansInSelectionByClient.set(loan.clientDbId, []);
                    }
                    loansInSelectionByClient.get(loan.clientDbId)!.push({
                        indexNo: idx.indexNo,
                        purpose: loan.purpose,
                        amount: loan.amount,
                        frequency: loan.frequency,
                    });
                });
            });

            const clientList = Array.from(allClients.values());
            const result = await apiClient.post<Record<string, any[]>>('/clients/ongoing-loans-bulk', {
                clientIds: clientList.map((c) => c.dbId),
            });

            if (!result.success || !result.data) {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch ongoing loan details. Please try again.',
                    variant: 'destructive',
                });
                setOngoingLoansData([]);
                return;
            }

            const ongoingLoansMap = new Map<string, { clientId: string; clientName: string; loans: any[]; duplicatesInBatch: any[] }>();
            clientList.forEach((client) => {
                const clientLoans = result.data![client.dbId] || [];
                const filteredLoans = clientLoans.filter((loan: any) => !loansBeingProcessed.has(loan.id));
                const duplicatesInBatch = loansInSelectionByClient.get(client.dbId) || [];
                const hasDuplicateInBatch = duplicatesInBatch.length > 1;

                if (filteredLoans.length > 0 || hasDuplicateInBatch) {
                    ongoingLoansMap.set(client.dbId, {
                        clientId: client.displayId,
                        clientName: client.name,
                        loans: filteredLoans,
                        duplicatesInBatch: hasDuplicateInBatch ? duplicatesInBatch : [],
                    });
                }
            });

            setOngoingLoansData(Array.from(ongoingLoansMap.values()));
        } catch (error) {
            console.error('Error fetching ongoing loans:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch ongoing loan details. Please try again.',
                variant: 'destructive',
            });
            setOngoingLoansData([]);
        } finally {
            setIsLoadingOngoingLoans(false);
        }
    };

    const handleAMAction = async () => {
        if (!amPendingAction) return;

        setIsSubmitting(true);
        try {
            const centerIndexMap: Record<string, string[]> = {};
            pendingIndexes
                .filter((idx) => selectedPendingIndexIds.includes(idx.id))
                .forEach((idx) => {
                    if (!centerIndexMap[idx.centerId]) centerIndexMap[idx.centerId] = [];
                    centerIndexMap[idx.centerId].push(idx.id);
                });

            let totalCount = 0;
            let hasError = false;

            for (const [centerId, indexIds] of Object.entries(centerIndexMap)) {
                const result = await apiClient.post('/disbursements/level2-action', {
                    centerId,
                    action: amPendingAction,
                    indexIds,
                });
                if (result.success) {
                    totalCount += (result.data as any)?.count ?? 0;
                } else {
                    toast({ title: 'Error', description: result.error || 'Action failed', variant: 'destructive' });
                    hasError = true;
                    break;
                }
            }

            if (!hasError) {
                toast({
                    title: 'Success',
                    description: amPendingAction === 'APPROVE'
                        ? `${totalCount} loan(s) approved for disbursement. Branch Manager will perform the final disbursal.`
                        : `${totalCount} loan(s) rejected successfully.`,
                });
                fetchAMStats(selectedBranchId, fromDate, toDate);
                setAmActionDialogOpen(false);
                setAmPendingAction(null);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to process action', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleProductEditSaved = (loanId: string, result: UpdatedLoanProduct) => {
        setPendingIndexes((prev) =>
            prev.map((idx) => ({
                ...idx,
                totalAmount: idx.loans.some((l) => l.id === loanId)
                    ? idx.loans.reduce(
                          (sum, l) => sum + (l.id === loanId ? result.amount : l.amount),
                          0
                      )
                    : idx.totalAmount,
                loans: idx.loans.map((loan) =>
                    loan.id === loanId
                        ? {
                              ...loan,
                              loanProductId: result.loanProductId,
                              amount: result.amount,
                              interestRate: result.interestRate,
                              tenureMonths: result.tenureMonths,
                              frequency: result.frequency,
                              tenure: `${result.tenureMonths} Months`,
                          }
                        : loan
                ),
            }))
        );
        setEditingLoan(null);
    };

    const handleRejectMember = async () => {
        if (!rejectingLoan) return;
        if (rejectReason.trim().length < 3) {
            toast({ title: 'Reason required', description: 'Enter a reason (at least 3 characters).', variant: 'destructive' });
            return;
        }
        setIsRejectingLoan(true);
        try {
            const result = await apiClient.post('/disbursements/reject-to-indexation', {
                loanId: rejectingLoan.loan.id,
                stage: 'AM_APPROVAL',
                reason: rejectReason.trim(),
            });
            if (result.success) {
                toast({ title: 'Member rejected', description: result.message || 'Sent back to Loan Indexation.' });
                setRejectingLoan(null);
                setRejectReason('');
                fetchAMStats(selectedBranchId, fromDate, toDate);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to reject member', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to reject member', variant: 'destructive' });
        } finally {
            setIsRejectingLoan(false);
        }
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(pendingIndexes);

    // ── RENDER ────────────────────────────────────────────────────────────────

    if (isLoading) {
        return <PageLoader label="Loading..." fullScreen={false} />;
    }

    if (userRole !== 'AREA_MANAGER' && userRole !== 'ADMIN') {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <ShieldX className="h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-semibold text-foreground">Access Restricted</p>
                <p className="text-sm text-muted-foreground">This page is for Area Managers. Branch Managers use Final Disbursement.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
            <div className="flex items-center justify-between pb-4 border-b border-border/40">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-sidebar-accent to-cyan-600 bg-clip-text text-transparent">
                        AM Loan Approval
                    </h1>
                    <p className="text-muted-foreground mt-2 text-base">
                        Review and edit loan product details before approving. The Branch Manager will perform the final disbursal.
                    </p>
                </div>
                <div className="hidden md:flex items-center gap-3">
                    <Badge variant="outline" className="text-sm py-1.5 px-4 h-9 rounded-full border-primary/30 bg-green-50 text-sidebar-accent dark:bg-brand-green-darker/20 dark:border-sidebar-accent dark:text-green-300">
                        {`${new Date().toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })}, ${toDisplayDate(new Date())}`}
                    </Badge>
                </div>
            </div>

            <Card className="border-border/60 shadow-lg overflow-hidden bg-card/50 backdrop-blur-sm relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-cyan-500" />

                <CardHeader className="pb-6 border-b border-border/40 bg-muted/10">
                    <div className="space-y-1">
                        <CardTitle className="text-xl font-semibold flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-primary dark:text-primary" />
                            Verification Queue
                        </CardTitle>
                        <CardDescription>
                            Filter by branch and date range to view loans pending AM approval.
                        </CardDescription>
                    </div>
                </CardHeader>

                <CardContent className="p-8 space-y-10">
                    {/* Filters */}
                    <div className="grid md:grid-cols-3 gap-6 p-5 rounded-xl border border-primary/20 bg-green-50/30 dark:bg-brand-green-darker/10">
                        <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <Filter className="h-3.5 w-3.5 text-primary" />
                                Branch
                            </Label>
                            <Select value={selectedBranchId} onValueChange={handleBranchChange}>
                                <SelectTrigger className="h-10 text-sm shadow-sm border-muted-foreground/20 focus:ring-2 focus:ring-primary/20">
                                    <SelectValue placeholder="Select branch..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id} className="cursor-pointer">
                                            {branch.code} - {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">From Date</Label>
                            <DateInput
                                value={fromDate}
                                onChange={(e) => handleFromDateChange(e.target.value)}
                                className="h-10"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">To Date</Label>
                            <DateInput
                                value={toDate}
                                min={fromDate}
                                onChange={(e) => handleToDateChange(e.target.value)}
                                className="h-10"
                            />
                        </div>
                    </div>

                    {/* Table Search */}
                    <div className="flex flex-wrap items-center gap-4">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search pending loans..."
                            className="ml-auto"
                        />
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="group relative p-5 rounded-2xl border bg-gradient-to-br from-white to-slate-50 dark:from-brand-green-darker dark:to-green-950 shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Total Loans</span>
                                <div className="h-8 w-8 rounded-full bg-brand-green-tint dark:bg-brand-green-darker/30 flex items-center justify-center text-primary dark:text-primary">
                                    <Users className="h-4 w-4" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold tracking-tight text-sidebar-accent dark:text-slate-100">
                                {isFetchingPending ? <Loader2 className="h-6 w-6 animate-spin" /> : amStats.totalClients}
                            </div>
                        </div>
                        <div className="group relative p-5 rounded-2xl border bg-gradient-to-br from-white to-slate-50 dark:from-brand-green-darker dark:to-green-950 shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Total Value</span>
                                <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                    <Banknote className="h-4 w-4" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold tracking-tight text-sidebar-accent dark:text-slate-100">
                                {isFetchingPending
                                    ? <Loader2 className="h-6 w-6 animate-spin" />
                                    : `₹${new Intl.NumberFormat('en-IN', { maximumSignificantDigits: 3 }).format(amStats.totalAmount)}`}
                            </div>
                        </div>
                    </div>

                    {/* Empty / Loading state */}
                    {isFetchingPending && (
                        <PageLoader label="Loading pending loans..." fullScreen={false} />
                    )}

                    {!isFetchingPending && selectedBranchId && searchedRows.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                            <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                            <p className="text-sm text-muted-foreground">No loans pending AM approval for this branch and date range.</p>
                        </div>
                    )}

                    {!isFetchingPending && !selectedBranchId && (
                        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                            <Filter className="h-8 w-8 text-muted-foreground/50" />
                            <p className="text-sm text-muted-foreground">Select a branch to load pending loans.</p>
                        </div>
                    )}

                    {/* Index batches */}
                    {!isFetchingPending && searchedRows.length > 0 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold tracking-tight text-foreground/90">Index Batches</h3>
                                <Badge variant="secondary" className="bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/30 dark:text-green-300">
                                    {searchedRows.length} Pending
                                </Badge>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-primary"
                                        checked={isPendingSelectAll}
                                        onChange={(e) => toggleSelectAllPending(e.target.checked)}
                                    />
                                    <span className="text-sm font-medium">Select all</span>
                                    <span className="text-xs text-muted-foreground">({selectedPendingIndexIds.length} selected)</span>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {searchedRows.map((idx) => (
                                    <div key={idx.id} className="border border-border/60 rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-md transition-all">
                                        <div
                                            className="p-4 bg-muted/20 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
                                            onClick={() => setAmExpandedIndexId(amExpandedIndexId === idx.id ? null : idx.id)}
                                        >
                                            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 accent-primary"
                                                        checked={selectedPendingIndexIds.includes(idx.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => togglePendingIndex(idx.id, e.target.checked)}
                                                    />
                                                    <div className="h-8 w-8 rounded-full bg-brand-green-tint dark:bg-brand-green-darker/30 flex items-center justify-center text-primary">
                                                        <span className="text-xs font-bold">L2</span>
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-sm">Index #{idx.indexNo}</p>
                                                        <p className="text-xs text-muted-foreground">{idx.indexDate}</p>
                                                    </div>
                                                </div>
                                                <div className="hidden md:block w-px h-8 bg-border/60" />
                                                <div className="flex gap-6 text-sm flex-wrap">
                                                    <div>
                                                        <span className="text-muted-foreground text-xs mr-1">Center</span>
                                                        <span className="font-medium">{idx.centerName}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-muted-foreground text-xs mr-1">Loans</span>
                                                        <span className="font-medium">{idx.totalLoans}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-muted-foreground text-xs mr-1">Total</span>
                                                        <span className="font-medium">₹{new Intl.NumberFormat('en-IN').format(idx.totalAmount)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <span className="text-xs font-medium uppercase tracking-wide">
                                                    {amExpandedIndexId === idx.id ? 'Collapse' : 'Review'}
                                                </span>
                                                {amExpandedIndexId === idx.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                            </div>
                                        </div>

                                        {amExpandedIndexId === idx.id && (
                                            <div className="border-t border-border/40 animate-in slide-in-from-top-2 duration-200">
                                                <div className="bg-green-50/50 dark:bg-brand-green-darker/20 overflow-x-auto">
                                                    <Table>
                                                        <TableHeader className="bg-muted/20 sticky top-0 backdrop-blur-sm z-10">
                                                            <TableRow>
                                                                <TableHead className="w-[120px]">Client ID</TableHead>
                                                                <TableHead>Client Name</TableHead>
                                                                <TableHead>Purpose</TableHead>
                                                                <TableHead>Frequency</TableHead>
                                                                <TableHead className="w-[140px]">Amount (₹)</TableHead>
                                                                <TableHead className="w-[130px] text-center">Verification</TableHead>
                                                                <TableHead className="w-[60px] text-center">Edit</TableHead>
                                                                {canApproveLoan && <TableHead className="w-[70px] text-center">Reject</TableHead>}
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {idx.loans.map((loan) => (
                                                                <TableRow key={loan.id} className="hover:bg-green-50/50 dark:hover:bg-brand-green-darker/10">
                                                                    <TableCell className="font-medium text-xs font-mono">{loan.clientId}</TableCell>
                                                                    <TableCell>
                                                                        <div className="flex items-center gap-2">
                                                                            <span>{loan.clientName}</span>
                                                                            <HighmarkHistoryButton
                                                                                clientId={loan.clientDbId}
                                                                                clientName={loan.clientName}
                                                                                centerName={idx.centerName}
                                                                                variant="outline"
                                                                                className="h-6 shrink-0 px-2 text-xs"
                                                                            />
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-muted-foreground text-sm">{loan.purpose}</TableCell>
                                                                    <TableCell>
                                                                        <span className="text-xs uppercase tracking-wide text-sidebar-accent dark:text-green-400">
                                                                            {loan.frequency}
                                                                        </span>
                                                                    </TableCell>
                                                                    <TableCell className="font-semibold text-primary dark:text-primary">
                                                                        ₹{new Intl.NumberFormat('en-IN').format(loan.amount)}
                                                                    </TableCell>
                                                                    <TableCell className="text-center">
                                                                        <div className="flex items-center justify-center gap-1.5">
                                                                            {loan.isVerified ? (
                                                                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">
                                                                                    Verified
                                                                                </Badge>
                                                                            ) : (
                                                                                <Badge variant="outline" className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700 text-[10px]">
                                                                                    <ShieldAlert className="h-3 w-3 mr-1" />Incomplete
                                                                                </Badge>
                                                                            )}
                                                                            <Button
                                                                                type="button"
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-6 w-6 p-0 text-primary hover:bg-brand-green-tint"
                                                                                onClick={() => setVerifyingLoanId(loan.id)}
                                                                                title="View Member Individual & GRT verification details"
                                                                            >
                                                                                <Eye className="h-3.5 w-3.5" />
                                                                            </Button>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-center">
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            className="h-7 w-7 p-0 text-primary hover:bg-brand-green-tint"
                                                                            onClick={() => setEditingLoan(loan)}
                                                                            title="Edit loan product"
                                                                        >
                                                                            <Pencil className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    </TableCell>
                                                                    {canApproveLoan && (
                                                                        <TableCell className="text-center">
                                                                            <Button
                                                                                type="button"
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                                                                                onClick={() => {
                                                                                    setRejectReason('');
                                                                                    setRejectingLoan({ loan, indexNo: idx.indexNo });
                                                                                }}
                                                                                title="Reject this member and send back to Loan Indexation"
                                                                            >
                                                                                <ShieldX className="h-3.5 w-3.5" />
                                                                            </Button>
                                                                        </TableCell>
                                                                    )}
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action footer */}
                    {!isFetchingPending && pendingIndexes.length > 0 && (
                        <div className={cn(
                            "flex flex-col md:flex-row items-center justify-between gap-6 pt-6 border-t border-dashed transition-opacity duration-300",
                            amStats.totalClients > 0 ? "opacity-100" : "opacity-50 pointer-events-none"
                        )}>
                            <div className="flex flex-col gap-3 flex-1">
                                <div className="flex items-center gap-4 bg-muted/40 px-4 py-3 rounded-lg border border-border/50 w-full md:w-auto">
                                    <Label className="cursor-default select-none font-medium flex flex-col">
                                        <span>Selected batches</span>
                                        <span className="text-xs text-muted-foreground font-normal">{selectedPendingIndexIds.length} selected</span>
                                    </Label>
                                </div>
                                {selectedPendingIndexIds.length > 0 && !detailsAcknowledged && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        Review the disbursement details before approving.
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-4 w-full md:w-auto justify-end">
                                {canApproveLoan && (
                                    <Button
                                        onClick={() => openAMActionDialog('REJECT')}
                                        disabled={selectedPendingIndexIds.length === 0 || isSubmitting}
                                        variant="outline"
                                        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/30 min-w-[120px] h-12"
                                    >
                                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldX className="mr-2 h-4 w-4" />}
                                        Reject
                                    </Button>
                                )}
                                {canApproveLoan && (
                                    <Button
                                        onClick={async () => {
                                            await fetchOngoingLoansForSelectedIndexes();
                                            setDetailsReviewOpen(true);
                                        }}
                                        disabled={selectedPendingIndexIds.length === 0 || isSubmitting || isLoadingOngoingLoans}
                                        variant="outline"
                                        className="border-primary/40 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-green-300 dark:hover:bg-brand-green-darker/30 min-w-[160px] h-12"
                                    >
                                        {isLoadingOngoingLoans ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <ShieldCheck className="mr-2 h-4 w-4" />
                                        )}
                                        Review Details
                                    </Button>
                                )}
                                {canApproveLoan && (
                                    <Button
                                        onClick={() => openAMActionDialog('APPROVE')}
                                        disabled={!detailsAcknowledged || isSubmitting}
                                        className="bg-primary hover:bg-primary text-white min-w-[200px] h-12 shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all"
                                    >
                                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                        Approve for Disbursement
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {editingLoan && (
                <LoanProductEditModal
                    open={!!editingLoan}
                    onOpenChange={(open) => { if (!open) setEditingLoan(null); }}
                    loanId={editingLoan.id}
                    currentProductId={editingLoan.loanProductId}
                    role="AM"
                    stage="DISBURSEMENT"
                    branchId={selectedBranchId}
                    maxAllowedAmount={editingLoan.maxAllowedAmount}
                    onSaved={(result) => handleProductEditSaved(editingLoan.id, result)}
                />
            )}

            <Dialog
                open={!!rejectingLoan}
                onOpenChange={(open) => {
                    if (!open && !isRejectingLoan) {
                        setRejectingLoan(null);
                        setRejectReason('');
                    }
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                            <ShieldX className="h-5 w-5" />
                            Reject Member
                        </DialogTitle>
                        <DialogDescription>
                            {rejectingLoan && (
                                <>
                                    <span className="font-medium text-foreground">
                                        {rejectingLoan.loan.clientId} — {rejectingLoan.loan.clientName}
                                    </span>{' '}
                                    (₹{new Intl.NumberFormat('en-IN').format(rejectingLoan.loan.amount)}) will be removed from
                                    index {rejectingLoan.indexNo} and sent back to Loan Indexation. The other members in this
                                    index stay pending for approval.
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="member-reject-reason">Reason</Label>
                        <Textarea
                            id="member-reject-reason"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Why is this member being rejected?"
                            rows={3}
                            disabled={isRejectingLoan}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => { setRejectingLoan(null); setRejectReason(''); }}
                            disabled={isRejectingLoan}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRejectMember}
                            disabled={isRejectingLoan || rejectReason.trim().length < 3}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isRejectingLoan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldX className="mr-2 h-4 w-4" />}
                            Reject &amp; Send to Indexation
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <MemberVerificationDialog
                loanId={verifyingLoanId}
                onClose={() => setVerifyingLoanId(null)}
            />

            <ConfirmationDialog
                open={amActionDialogOpen}
                onOpenChange={(open) => {
                    setAmActionDialogOpen(open);
                    if (!open) setAmPendingAction(null);
                }}
                onConfirm={handleAMAction}
                title={amPendingAction === 'REJECT' ? 'Reject Loans' : 'Approve for Disbursement'}
                description={
                    amPendingAction === 'APPROVE'
                        ? `You are approving ${selectedPendingIndexIds.length} index batch(es) for disbursement. The Branch Manager will then perform the final disbursal with attendance and due date entry.`
                        : `You are about to reject ${selectedPendingIndexIds.length} index batch(es). All loans in those batches will be marked as rejected.`
                }
                confirmText={amPendingAction === 'REJECT' ? 'Reject' : 'Approve for Disbursement'}
                cancelText="Cancel"
                type={amPendingAction === 'REJECT' ? 'delete' : 'info'}
                isLoading={isSubmitting}
            />

            {/* Client Ongoing Loans Dialog */}
            <Dialog open={detailsReviewOpen} onOpenChange={setDetailsReviewOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            Clients With Ongoing Loan(s)
                        </DialogTitle>
                        <DialogDescription>
                            Review clients who have active loan(s) in the selected batch(es) before approving.
                        </DialogDescription>
                    </DialogHeader>

                    {isLoadingOngoingLoans ? (
                        <PageLoader fullScreen={false} />
                    ) : ongoingLoansData.length > 0 ? (
                        <div className="space-y-3 my-6">
                            {ongoingLoansData.map((clientInfo) => {
                                const repeatCount = clientInfo.loans.length;
                                const statusCounts = clientInfo.loans.reduce((acc: Record<string, number>, loan: any) => {
                                    acc[loan.status] = (acc[loan.status] || 0) + 1;
                                    return acc;
                                }, {});
                                return (
                                <div key={clientInfo.clientId} className="space-y-2">
                                    <div className="flex items-center gap-2 px-1 flex-wrap">
                                        <h4 className="font-semibold text-amber-900 dark:text-amber-100">
                                            {clientInfo.clientName}
                                        </h4>
                                        {repeatCount > 1 && (
                                            <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300 text-[10px]">
                                                Repeated ×{repeatCount}
                                            </Badge>
                                        )}
                                        {clientInfo.duplicatesInBatch.length > 1 && (
                                            <Badge className="bg-rose-600 text-white hover:bg-rose-600 text-[10px]">
                                                Duplicate in this batch ×{clientInfo.duplicatesInBatch.length}
                                            </Badge>
                                        )}
                                        {Object.entries(statusCounts).map(([status, count]) => (
                                            <Badge
                                                key={status}
                                                variant="outline"
                                                className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700 text-[10px]"
                                            >
                                                {status}{(count as number) > 1 ? ` ×${count}` : ''}
                                            </Badge>
                                        ))}
                                    </div>
                                    {clientInfo.loans.map((loan: any) => {
                                        const totalOutstanding = (loan.outstandingPrincipal ?? 0) + (loan.outstandingInterest ?? 0);
                                        return (
                                            <div key={loan.id} className={cn(
                                                "border-l-4 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 p-4 shadow-sm",
                                                (loan.arrear ?? 0) > 0 ? "border-l-red-600" : "border-l-amber-600"
                                            )}>
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <h5 className="font-bold text-amber-900 dark:text-amber-100">{loan.loanNumber}</h5>
                                                            <Badge className="bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 text-xs">{loan.status}</Badge>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                                            <div>
                                                                <span className="text-sidebar-accent dark:text-slate-400">Product:</span>
                                                                <p className="font-semibold text-sidebar-accent dark:text-slate-100">{loan.productName}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-sidebar-accent dark:text-slate-400">Disbursed:</span>
                                                                <p className="font-semibold text-sidebar-accent dark:text-slate-100">{loan.disbursementDate}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="mb-3">
                                                            <span className="text-xs text-sidebar-accent dark:text-slate-400">Outstanding</span>
                                                            <p className="font-bold text-lg text-amber-700 dark:text-amber-300">
                                                                ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(totalOutstanding)}
                                                            </p>
                                                        </div>
                                                        {(loan.arrear ?? 0) > 0 && (
                                                            <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800">
                                                                <p className="text-xs font-semibold text-red-600 dark:text-red-400">Arrear</p>
                                                                <p className="font-bold text-base text-red-600 dark:text-red-400">
                                                                    ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.arrear)}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {clientInfo.duplicatesInBatch.length > 1 && (
                                        <div className="space-y-2">
                                            <p className="text-xs font-semibold text-rose-700 dark:text-rose-400 px-1">
                                                {clientInfo.duplicatesInBatch.length} loans for this client in the current selection:
                                            </p>
                                            {clientInfo.duplicatesInBatch.map((dup: any, i: number) => (
                                                <div key={i} className="border-l-4 border-l-rose-600 rounded-lg bg-gradient-to-r from-rose-50 to-red-50 dark:from-rose-950/30 dark:to-red-950/30 p-3 shadow-sm">
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <h5 className="font-bold text-rose-900 dark:text-rose-100 text-sm">Index #{dup.indexNo}</h5>
                                                                <Badge className="bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100 text-[10px]">Pending (this batch)</Badge>
                                                            </div>
                                                            <p className="text-xs text-rose-800 dark:text-rose-300">{dup.purpose} · {dup.frequency}</p>
                                                        </div>
                                                        <p className="font-bold text-rose-700 dark:text-rose-300">
                                                            ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(dup.amount)}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-muted-foreground">
                            <p>No clients with ongoing loans in the selected batch(es).</p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            onClick={() => {
                                setDetailsReviewOpen(false);
                                setDetailsAcknowledged(true);
                            }}
                            className="bg-teal-600 hover:bg-teal-700"
                        >
                            OK
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
