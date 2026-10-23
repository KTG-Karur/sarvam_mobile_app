'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { ForeclosureApprovalClient } from '@/components/collections/ForeclosureApprovalClient';
import { LoanWriteoffClosureClient } from '@/components/collections/LoanWriteoffClosureClient';
import { PendingCollectionsTable } from './collection-modes/PendingCollectionsTable';
import { AllocateForEodTab } from './collection-modes/AllocateForEodTab';
import { CollectionRow, PendingCollectionsResponse } from './collection-modes/types';
import { DateInput } from '@/components/ui/date-input';

type Branch = { id: string; name: string; code: string };
type Center = { id: string; name: string; code: string };
type Officer = { id: string; firstName: string; lastName: string };

const getTodayDate = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MODE_TABS = [
    { value: 'DEMAND', label: 'Demand' },
    // ADVANCE = EMI paid before its due date (always shown — it's loan repayment).
    // LOAN_ADVANCE = loan-advance wallet collection only; hidden when the feature is off.
    { value: 'ADVANCE', label: 'Advance EMI' },
    { value: 'LOAN_ADVANCE', label: 'Loan Advance' },
    { value: 'ARREAR', label: 'Arrear' },
    { value: 'PRE_CLOSE', label: 'Pre-Close' },
    { value: 'CLOSE_LOANS', label: 'Close Loans' },
    { value: 'GOLD_LOAN', label: 'Gold Loan' },
    { value: 'ALLOCATE_EOD', label: 'Allocate for EOD' },
] as const;

export function CollectionApprovalClient() {
    const { canPage, hasRole } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const canApproveCollection = canPage('/dashboard/collections/approval', 'approve');
    const { toast } = useToast();

    const storedUser = tokenStorage.getUser();
    // ADMIN, AREA_MANAGER, or any other role explicitly assigned more than one
    // branch (UserBranchAssignment) gets the branch picker — a single-branch
    // user (the common case) never sees it.
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const isMultiBranchOtherRole =
        !isAdminOrAM && (storedUser?.assignedBranchIds?.length ?? 0) > 1;
    const canPickBranch = isAdminOrAM || isMultiBranchOtherRole;
    const isAdmin = storedUser?.role === 'ADMIN' || hasRole('admin');

    // storedUser comes from localStorage, which doesn't exist during SSR — rendering the
    // Branch field's role-based Select-vs-Input branch straight off isAdminOrAM makes the
    // server's markup (always the non-admin Input branch) disagree with the client's first
    // render (real role, possibly the Select branch), causing a hydration mismatch. Force both
    // to render the same placeholder until after mount, same pattern as UserMenu.tsx.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Scoped to the page's own branch selection (not the session-active branch) so switching
    // branch here re-resolves the correct branch's EOD working date instead of staying pinned
    // to whatever branch was active at mount.
    const { eodWorkingDate } = useEodWorkingDate(branchId);

    const [centers, setCenters] = useState<Center[]>([]);
    const [centerId, setCenterId] = useState('');

    const [officers, setOfficers] = useState<Officer[]>([]);
    const [collectedById, setCollectedById] = useState('');

    const [collectionDate, setCollectionDate] = useState(getTodayDate());

    const [rows, setRows] = useState<CollectionRow[]>([]);
    const [denominationByCenter, setDenominationByCenter] = useState<PendingCollectionsResponse['denominationByCenter']>([]);
    const [isLoadingRows, setIsLoadingRows] = useState(false);
    // Rows approved in this session stay visible (with a tick) instead of disappearing —
    // cleared whenever the feed is reloaded for a different date/branch/center/officer.
    const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<typeof MODE_TABS[number]['value']>('DEMAND');
    // Bumped after every successful approve so the Allocate-for-EOD tab (which fetches its own
    // APPROVED-but-not-yet-allocated data independently of `rows`) refetches instead of showing
    // stale data until a manual page refresh.
    const [allocationRefreshKey, setAllocationRefreshKey] = useState(0);

    // ── Branch / Center / Officer lookups ──────────────────────────────────
    useEffect(() => {
        const loadBranches = async () => {
            if (canPickBranch) {
                setIsLoadingBranches(true);
                try {
                    const res = await fetch('/api/branches');
                    const json = await res.json();
                    let list: Branch[] = (json?.data ?? []).map((b: Branch) => ({ id: b.id, name: b.name, code: b.code }));
                    if (isMultiBranchOtherRole) {
                        const assignedBranchIds = storedUser?.assignedBranchIds ?? [];
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                    setBranches(list);
                    const activeBranch = branchStorage.getActiveBranch();
                    const preferredId = activeBranch?.id ?? storedUser?.branchId;
                    const match = list.find((b) => b.id === preferredId) ?? list[0];
                    if (match) setBranchId(match.id);
                } catch {
                    toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                } finally {
                    setIsLoadingBranches(false);
                }
            } else {
                const activeBranch = branchStorage.getActiveBranch();
                setBranchId(activeBranch?.id ?? storedUser?.branchId ?? '');
            }
        };
        loadBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (eodWorkingDate) setCollectionDate(eodWorkingDate);
    }, [eodWorkingDate]);

    useEffect(() => {
        if (!branchId) return;
        setCenterId('');
        apiClient
            .get<Center[]>(`/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`)
            .then((result) => { if (result.success) setCenters(result.data || []); });
        apiClient
            .get<{ users: Officer[] }>(`/users?role=FDO&branchId=${branchId}&pageSize=100`)
            .then((result) => { if (result.success) setOfficers(result.data?.users || []); });
    }, [branchId]);

    // ── Pending collections feed (shared by Demand/Advance/Arrear/Gold) ──
    const fetchRows = useCallback(async () => {
        if (!branchId) return;
        setIsLoadingRows(true);
        try {
            // 'ALL' = pending + already-approved rows together, so this page reads as a
            // running history for the day instead of a queue that empties out once approved
            // (or once its funder gets allocated for EOD, which doesn't change the row itself).
            const params = new URLSearchParams({ branchId, date: collectionDate, status: 'ALL' });
            if (centerId) params.set('centerId', centerId);
            if (collectedById) params.set('collectedById', collectedById);
            const result = await apiClient.get<PendingCollectionsResponse>(`/collections/approve?${params.toString()}`);
            if (result.success && result.data) {
                setRows(result.data.rows);
                setDenominationByCenter(result.data.denominationByCenter);
                setApprovedIds(new Set());
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load pending collections.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not connect to the server.', variant: 'destructive' });
        } finally {
            setIsLoadingRows(false);
        }
    }, [branchId, collectionDate, centerId, collectedById, toast]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    // Single in-flight lock shared by every tab and every Approve / Approve All button. Approving
    // one row also approves the other pending rows of the same loan + batch (repayment and its
    // loan-advance pair), so a second click from another tab while the first request is still
    // running would apply the same collection twice. The ref blocks synchronously (two clicks in
    // the same tick); the state drives the disabled buttons and the loader.
    const approvingRef = useRef(false);
    const [isApproving, setIsApproving] = useState(false);

    const handleApproveRow = useCallback(async (transactionId: string) => {
        if (approvingRef.current) return;
        approvingRef.current = true;
        setIsApproving(true);
        try {
            const result = await apiClient.post('/collections/approve', { transactionId, action: 'APPROVE' });
            if (result.success) {
                toast({ title: 'Approved', description: result.message || 'Collection approved successfully.' });
                setApprovedIds((prev) => new Set(prev).add(transactionId));
                setAllocationRefreshKey((k) => k + 1);
            } else {
                toast({ title: 'Action Failed', description: result.error || 'Check server logs for details.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            approvingRef.current = false;
            setIsApproving(false);
        }
    }, [toast]);

    // Funder-wise "Approve All" — approves every pending row shown for one funder (within
    // whichever Demand/Advance/Arrear/Gold tab it was clicked from) in a single request.
    const handleApproveManyRows = useCallback(async (transactionIds: string[]) => {
        if (transactionIds.length === 0 || approvingRef.current) return;
        approvingRef.current = true;
        setIsApproving(true);
        try {
            const result = await apiClient.post('/collections/approve', { transactionIds, action: 'APPROVE' });
            if (result.success) {
                toast({ title: 'Approved', description: result.message || `Approved ${transactionIds.length} collections.` });
                setApprovedIds((prev) => {
                    const next = new Set(prev);
                    transactionIds.forEach((id) => next.add(id));
                    return next;
                });
                setAllocationRefreshKey((k) => k + 1);
            } else {
                toast({ title: 'Action Failed', description: result.error || 'Check server logs for details.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            approvingRef.current = false;
            setIsApproving(false);
        }
    }, [toast]);

    const demandRows = useMemo(() => rows.filter((r) => r.mode === 'DEMAND' && !r.isGoldLoan), [rows]);
    const advanceRows = useMemo(() => rows.filter((r) => r.mode === 'ADVANCE' && !r.isGoldLoan), [rows]);
    const arrearRows = useMemo(() => rows.filter((r) => r.mode === 'ARREAR' && !r.isGoldLoan), [rows]);
    const loanAdvanceRows = useMemo(() => rows.filter((r) => r.mode === 'LOAN_ADVANCE' && !r.isGoldLoan), [rows]);
    const goldRows = useMemo(() => rows.filter((r) => r.isGoldLoan), [rows]);

    // Each tab searches independently within its own already-filtered subset.
    const { query: demandSearchQuery, setQuery: setDemandSearchQuery, filtered: searchedDemandRows } = useTableSearch(demandRows);
    const { query: advanceSearchQuery, setQuery: setAdvanceSearchQuery, filtered: searchedAdvanceRows } = useTableSearch(advanceRows);
    const { query: arrearSearchQuery, setQuery: setArrearSearchQuery, filtered: searchedArrearRows } = useTableSearch(arrearRows);
    const { query: loanAdvanceSearchQuery, setQuery: setLoanAdvanceSearchQuery, filtered: searchedLoanAdvanceRows } = useTableSearch(loanAdvanceRows);
    const { query: goldSearchQuery, setQuery: setGoldSearchQuery, filtered: searchedGoldRows } = useTableSearch(goldRows);

    // The feature flag loads async (defaults to enabled), so the Loan Advance tab can be
    // selected before it resolves to disabled — fall back to Demand instead of leaving
    // its content on screen with no visible tab.
    useEffect(() => {
        if (!loanAdvanceEnabled && activeTab === 'LOAN_ADVANCE') setActiveTab('DEMAND');
    }, [loanAdvanceEnabled, activeTab]);

    return (
        <div className="space-y-6">
            {isApproving && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
                    role="status"
                    aria-live="polite"
                >
                    <div className="flex items-center gap-3 rounded-lg border bg-card px-6 py-4 shadow-lg">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <div>
                            <p className="text-sm font-medium">Approving collections…</p>
                            <p className="text-xs text-muted-foreground">Please wait — do not click again or refresh.</p>
                        </div>
                    </div>
                </div>
            )}
            <div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-primary bg-clip-text text-transparent">
                    Collection Approve
                </h1>
                <p className="text-muted-foreground mt-1">Review and authorize collections submitted by Field Officers, mode by mode.</p>
            </div>

            <Card>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <Label className="mb-1.5 block">Collection Date</Label>
                            <DateInput value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} />
                        </div>
                        <div>
                            <Label className="mb-1.5 block">Branch</Label>
                            {!mounted ? (
                                <Input value="" disabled />
                            ) : canPickBranch ? (
                                <Select value={branchId} onValueChange={setBranchId} disabled={isLoadingBranches}>
                                    <SelectTrigger><SelectValue placeholder="Select Branch" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input value={branchStorage.getActiveBranch()?.name ?? ''} disabled />
                            )}
                        </div>
                        <div>
                            <Label className="mb-1.5 block">Collected By</Label>
                            <Select value={collectedById || 'ALL'} onValueChange={(v) => setCollectedById(v === 'ALL' ? '' : v)}>
                                <SelectTrigger><SelectValue placeholder="All Officers" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Officers</SelectItem>
                                    {officers.map((o) => (
                                        <SelectItem key={o.id} value={o.id}>{o.firstName} {o.lastName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label className="mb-1.5 block">Center</Label>
                            <Select value={centerId || 'ALL'} onValueChange={(v) => setCenterId(v === 'ALL' ? '' : v)}>
                                <SelectTrigger><SelectValue placeholder="All Centers" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Centers</SelectItem>
                                    {centers.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <Button onClick={fetchRows} disabled={isLoadingRows}>
                            {isLoadingRows ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Submit
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                <TabsList className="flex-wrap h-auto">
                    {MODE_TABS.filter((tab) => loanAdvanceEnabled || tab.value !== 'LOAN_ADVANCE').map((tab) => (
                        <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
                    ))}
                </TabsList>

                {isLoadingRows && ['DEMAND', 'ADVANCE', 'LOAN_ADVANCE', 'ARREAR', 'GOLD_LOAN'].includes(activeTab) ? (
                    <PageLoader label="Loading collections..." fullScreen={false} />
                ) : (
                    <>
                        <TabsContent value="DEMAND">
                            {demandRows.length > 0 && (
                                <div className="mb-3 flex justify-end">
                                    <TableSearchInput
                                        value={demandSearchQuery}
                                        onChange={setDemandSearchQuery}
                                        placeholder="Search demand collections..."
                                    />
                                </div>
                            )}
                            <PendingCollectionsTable
                                rows={searchedDemandRows}
                                collectionLabel="Demand Collection"
                                canApprove={canApproveCollection}
                                emptyText="No Demand collection Found"
                                onApprove={handleApproveRow}
                                onApproveMany={handleApproveManyRows}
                                approvalLocked={isApproving}
                                approvedIds={approvedIds}
                                denominationCenters={denominationByCenter}
                            />
                        </TabsContent>
                        <TabsContent value="ADVANCE">
                            {advanceRows.length > 0 && (
                                <div className="mb-3 flex justify-end">
                                    <TableSearchInput
                                        value={advanceSearchQuery}
                                        onChange={setAdvanceSearchQuery}
                                        placeholder="Search advance EMI collections..."
                                    />
                                </div>
                            )}
                            <PendingCollectionsTable
                                rows={searchedAdvanceRows}
                                collectionLabel="Advance EMI Collection"
                                canApprove={canApproveCollection}
                                emptyText="No Advance EMI collection Found"
                                onApprove={handleApproveRow}
                                onApproveMany={handleApproveManyRows}
                                approvalLocked={isApproving}
                                approvedIds={approvedIds}
                            />
                        </TabsContent>
                        {loanAdvanceEnabled && (
                            <TabsContent value="LOAN_ADVANCE">
                                {loanAdvanceRows.length > 0 && (
                                    <div className="mb-3 flex justify-end">
                                        <TableSearchInput
                                            value={loanAdvanceSearchQuery}
                                            onChange={setLoanAdvanceSearchQuery}
                                            placeholder="Search loan advance collections..."
                                        />
                                    </div>
                                )}
                                <PendingCollectionsTable
                                    rows={searchedLoanAdvanceRows}
                                    collectionLabel="Loan Advance Collection"
                                    canApprove={canApproveCollection}
                                    emptyText="No Loan Advance collection Found"
                                    onApprove={handleApproveRow}
                                    onApproveMany={handleApproveManyRows}
                                    approvalLocked={isApproving}
                                    approvedIds={approvedIds}
                                />
                            </TabsContent>
                        )}
                        <TabsContent value="ARREAR">
                            {arrearRows.length > 0 && (
                                <div className="mb-3 flex justify-end">
                                    <TableSearchInput
                                        value={arrearSearchQuery}
                                        onChange={setArrearSearchQuery}
                                        placeholder="Search arrear collections..."
                                    />
                                </div>
                            )}
                            <PendingCollectionsTable
                                rows={searchedArrearRows}
                                collectionLabel="Arrear Collection"
                                showDueColumns={false}
                                canApprove={canApproveCollection}
                                emptyText="No Arrear collection Found"
                                onApprove={handleApproveRow}
                                onApproveMany={handleApproveManyRows}
                                approvalLocked={isApproving}
                                approvedIds={approvedIds}
                            />
                        </TabsContent>
                        <TabsContent value="GOLD_LOAN">
                            {goldRows.length > 0 && (
                                <div className="mb-3 flex justify-end">
                                    <TableSearchInput
                                        value={goldSearchQuery}
                                        onChange={setGoldSearchQuery}
                                        placeholder="Search gold collections..."
                                    />
                                </div>
                            )}
                            <PendingCollectionsTable
                                rows={searchedGoldRows}
                                collectionLabel="Gold Collection"
                                showDueColumns={false}
                                canApprove={canApproveCollection}
                                emptyText="No goldLoan collection Found"
                                onApprove={handleApproveRow}
                                onApproveMany={handleApproveManyRows}
                                approvalLocked={isApproving}
                                approvedIds={approvedIds}
                            />
                        </TabsContent>
                    </>
                )}

                <TabsContent value="PRE_CLOSE">
                    <ForeclosureApprovalClient branchId={branchId} centerId={centerId} />
                </TabsContent>

                <TabsContent value="CLOSE_LOANS">
                    {isAdmin ? (
                        <LoanWriteoffClosureClient branchId={branchId} />
                    ) : (
                        <Card className="border-dashed border-2">
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <ShieldCheck className="h-8 w-8 text-slate-300 mb-3" />
                                <p className="text-slate-500">Only Admin can close loans. This tab is view-only for your role.</p>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="ALLOCATE_EOD">
                    <AllocateForEodTab
                        branchId={branchId}
                        collectionDate={collectionDate}
                        canAllocate={canApproveCollection}
                        refreshKey={allocationRefreshKey}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
