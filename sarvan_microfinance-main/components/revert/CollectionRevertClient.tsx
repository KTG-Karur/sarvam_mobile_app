'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { Loader2, RotateCcw, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { RevertLocationCell } from '@/components/revert/RevertLocationCell';
import { CollectionRow, PendingCollectionsResponse, formatCurrency, formatDate } from '@/components/approval/collection-modes/types';
import { BatchRevertDialog } from '@/components/revert/BatchRevertDialog';
import { Switch } from '@/components/ui/switch';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';

type Branch = { id: string; name: string; code: string };
type Center = { id: string; name: string; code: string };
type Officer = { id: string; firstName: string; lastName: string };

const getTodayDate = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MODE_TABS = [
    { value: 'DEMAND', label: 'Demand' },
    // ADVANCE = EMI paid before its due date; LOAN_ADVANCE = loan-advance wallet
    // collection only (hidden when the Loan Advance feature is off).
    { value: 'ADVANCE', label: 'Advance EMI' },
    { value: 'LOAN_ADVANCE', label: 'Loan Advance' },
    { value: 'ARREAR', label: 'Arrear' },
    { value: 'GOLD_LOAN', label: 'Gold Loan' },
] as const;

export function CollectionRevertClient() {
    const { toast } = useToast();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [isMounted, setIsMounted] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [centers, setCenters] = useState<Center[]>([]);
    const [centerId, setCenterId] = useState('');
    const [officers, setOfficers] = useState<Officer[]>([]);
    const [collectedById, setCollectedById] = useState('');
    const [collectionDate, setCollectionDate] = useState(getTodayDate());

    const [rows, setRows] = useState<CollectionRow[]>([]);
    const [isLoadingRows, setIsLoadingRows] = useState(false);
    const [activeTab, setActiveTab] = useState<typeof MODE_TABS[number]['value']>('DEMAND');

    // Separate filter: Approved collections (default) vs. the reverted history view.
    const [showReverted, setShowReverted] = useState(false);

    const [batchDialog, setBatchDialog] = useState<{ collectionBatchId: string; preselectedTransactionId?: string } | null>(null);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const storedUser = isMounted ? tokenStorage.getUser() : null;
    const isAreaManager = storedUser?.role === 'AREA_MANAGER';
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager;

    useEffect(() => {
        if (!isMounted) return;
        const loadBranches = async () => {
            if (isAdminOrAM) {
                setIsLoadingBranches(true);
                try {
                    const res = await fetch('/api/branches');
                    const json = await res.json();
                    let list: Branch[] = (json?.data ?? []).map((b: Branch) => ({ id: b.id, name: b.name, code: b.code }));
                    if (isAreaManager) {
                        const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                        if (assignedBranchIds.length > 0) {
                            list = list.filter((b) => assignedBranchIds.includes(b.id));
                        }
                    }
                    setBranches(list);
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
    }, [isMounted, isAdminOrAM, isAreaManager]);

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

    const fetchRows = useCallback(async () => {
        if (!branchId) return;
        setIsLoadingRows(true);
        try {
            const params = new URLSearchParams({ branchId, date: collectionDate, status: showReverted ? 'REVERTED' : 'APPROVED' });
            if (centerId) params.set('centerId', centerId);
            if (collectedById) params.set('collectedById', collectedById);
            const result = await apiClient.get<PendingCollectionsResponse>(`/collections/approve?${params.toString()}`);
            if (result.success && result.data) {
                setRows(result.data.rows);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load reversible collections.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not connect to the server.', variant: 'destructive' });
        } finally {
            setIsLoadingRows(false);
        }
    }, [branchId, collectionDate, centerId, collectedById, showReverted, toast]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    // Two independent locks, both applying to everyone with no Admin bypass:
    // EOD-lock (once EOD has moved the branch's working date past a collection's
    // date, it can no longer be reverted) and allocation-lock (a collection still
    // allocated for EOD must have that allocation reverted first).
    const canRevertRow = (row: CollectionRow) => !row.isEodLocked && !row.isAllocationLocked;

    const demandRows = useMemo(() => rows.filter((r) => r.mode === 'DEMAND' && !r.isGoldLoan), [rows]);
    const advanceRows = useMemo(() => rows.filter((r) => r.mode === 'ADVANCE' && !r.isGoldLoan), [rows]);
    const arrearRows = useMemo(() => rows.filter((r) => r.mode === 'ARREAR' && !r.isGoldLoan), [rows]);
    const loanAdvanceRows = useMemo(() => rows.filter((r) => r.mode === 'LOAN_ADVANCE' && !r.isGoldLoan), [rows]);
    const goldRows = useMemo(() => rows.filter((r) => r.isGoldLoan), [rows]);

    const rowsByTab: Record<typeof MODE_TABS[number]['value'], CollectionRow[]> = {
        DEMAND: demandRows,
        ADVANCE: advanceRows,
        LOAN_ADVANCE: loanAdvanceRows,
        ARREAR: arrearRows,
        GOLD_LOAN: goldRows,
    };

    const visibleTabs = MODE_TABS.filter((tab) => loanAdvanceEnabled || tab.value !== 'LOAN_ADVANCE');

    // Feature flag loads async (defaults to enabled) — don't leave a hidden tab selected.
    useEffect(() => {
        if (!loanAdvanceEnabled && activeTab === 'LOAN_ADVANCE') setActiveTab('DEMAND');
    }, [loanAdvanceEnabled, activeTab]);

    const activeRows = rowsByTab[activeTab];

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(activeRows);

    const batches = useMemo(() => {
        const map = new Map<string, { centerName: string; centerCode: string; count: number; lockedCount: number }>();
        for (const row of activeRows) {
            if (!row.batchId) continue;
            if (!map.has(row.batchId)) {
                map.set(row.batchId, { centerName: row.centerName, centerCode: row.centerCode, count: 0, lockedCount: 0 });
            }
            const bucket = map.get(row.batchId)!;
            bucket.count += 1;
            if (!canRevertRow(row)) bucket.lockedCount += 1;
        }
        return Array.from(map.entries()).map(([batchId, v]) => ({ batchId, ...v, allLocked: v.lockedCount === v.count }));
    }, [activeRows]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-rose-600 to-red-700 bg-clip-text text-transparent">
                    Collection Revert
                </h1>
                <p className="text-muted-foreground mt-1">Undo an already-approved collection, mode by mode, or a whole center&apos;s batch at once.</p>
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
                            {isAdminOrAM ? (
                                <Select value={branchId} onValueChange={setBranchId} disabled={isLoadingBranches}>
                                    <SelectTrigger><SelectValue placeholder="Select Branch" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input value={isMounted ? (branchStorage.getActiveBranch()?.name ?? '') : ''} disabled />
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
                    <div className="mt-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <Switch checked={showReverted} onCheckedChange={setShowReverted} />
                            <div>
                                <Label className="text-sm font-semibold">Show Reverted Collections</Label>
                                <p className="text-xs text-muted-foreground">
                                    {showReverted
                                        ? 'Viewing reverted collections — showing who reverted each one and when.'
                                        : 'Off shows approved, revertible collections. Turn on to view the reverted history instead.'}
                                </p>
                            </div>
                        </div>
                        <Button onClick={fetchRows} disabled={isLoadingRows}>
                            {isLoadingRows ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Submit
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-4">
                <TableSearchInput
                    value={tableSearchQuery}
                    onChange={setTableSearchQuery}
                    placeholder="Search collections..."
                    className="ml-auto"
                />
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                <TabsList>
                    {visibleTabs.map((tab) => (
                        <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
                    ))}
                </TabsList>

                {isLoadingRows ? (
                    <PageLoader
                        label={showReverted ? 'Loading reverted collections...' : 'Loading approved collections...'}
                        fullScreen={false}
                    />
                ) : (
                    visibleTabs.map((tab) => (
                        <TabsContent key={tab.value} value={tab.value}>
                            {!showReverted && batches.length > 0 && (
                                <div className="mb-4 flex flex-wrap gap-2">
                                    {batches.map((b) => (
                                        <Button
                                            key={b.batchId}
                                            variant="outline"
                                            size="sm"
                                            className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                            disabled={b.allLocked}
                                            onClick={() => setBatchDialog({ collectionBatchId: b.batchId })}
                                        >
                                            {b.allLocked ? <Lock className="h-3.5 w-3.5 mr-1.5" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                                            Review &amp; Revert — {b.centerCode ? `${b.centerCode} - ` : ''}{b.centerName} ({b.count}{b.lockedCount > 0 ? `, ${b.lockedCount} locked` : ''})
                                        </Button>
                                    ))}
                                </div>
                            )}

                            <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>S.No</TableHead>
                                            <TableHead>Member #</TableHead>
                                            <TableHead>Member Name</TableHead>
                                            <TableHead>Product Name</TableHead>
                                            <TableHead>Collection Date</TableHead>
                                            <TableHead className="text-right">Principal</TableHead>
                                            <TableHead className="text-right">Interest</TableHead>
                                            <TableHead className="text-right">Total Amount</TableHead>
                                            <TableHead>Collected By</TableHead>
                                            <TableHead>Funder</TableHead>
                                            {showReverted ? (
                                                <>
                                                    <TableHead>Reverted By</TableHead>
                                                    <TableHead>Reverted On</TableHead>
                                                    <TableHead>Revert Reason</TableHead>
                                                    <TableHead>Revert Location</TableHead>
                                                </>
                                            ) : (
                                                <TableHead>Revert</TableHead>
                                            )}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={showReverted ? 13 : 11} className="text-center text-muted-foreground py-8">
                                                    {showReverted
                                                        ? 'No reverted collections found for this filter.'
                                                        : 'No approved collections found for this filter.'}
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            searchedRows.map((row, idx) => (
                                                <TableRow key={row.transactionId}>
                                                    <TableCell>{idx + 1}</TableCell>
                                                    <TableCell className="font-mono text-xs">{row.clientCode}</TableCell>
                                                    <TableCell>{row.clientName}</TableCell>
                                                    <TableCell>{row.productName}</TableCell>
                                                    <TableCell>{formatDate(row.collectionDate)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(row.principalAmount)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(row.interestAmount)}</TableCell>
                                                    <TableCell className="text-right font-medium">{formatCurrency(row.totalAmount)}</TableCell>
                                                    <TableCell className="text-xs">{row.collectedByName}</TableCell>
                                                    <TableCell className="text-xs">{row.funderName}</TableCell>
                                                    {showReverted ? (
                                                        <>
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
                                                        </>
                                                    ) : (
                                                        <TableCell>
                                                            {canRevertRow(row) ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                                                    disabled={!row.batchId}
                                                                    onClick={() =>
                                                                        row.batchId &&
                                                                        setBatchDialog({
                                                                            collectionBatchId: row.batchId,
                                                                            preselectedTransactionId: row.transactionId,
                                                                        })
                                                                    }
                                                                >
                                                                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Revert
                                                                </Button>
                                                            ) : row.isEodLocked ? (
                                                                <span className="inline-flex items-center text-xs text-muted-foreground">
                                                                    <Lock className="h-3 w-3 mr-1" /> EOD locked
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center text-xs text-amber-600">
                                                                    <Lock className="h-3 w-3 mr-1" /> Allocated — revert allocation first
                                                                </span>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </TabsContent>
                    ))
                )}
            </Tabs>

            {batchDialog && (
                <BatchRevertDialog
                    collectionBatchId={batchDialog.collectionBatchId}
                    preselectedTransactionId={batchDialog.preselectedTransactionId}
                    onClose={() => setBatchDialog(null)}
                    onReverted={fetchRows}
                />
            )}
        </div>
    );
}
