'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Loader2, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { useToast } from '@/hooks/use-toast';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { formatCurrency } from './types';

interface PendingAllocationTransaction {
    transactionId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    productName: string;
    dueCount: string;
    dueDate: string | null;
    collectionDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    loanAdvanceAmount: number;
    collectedByName: string;
}

interface AllocationBatch {
    batchNumber: number;
    status: 'ALLOCATED' | 'PENDING';
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    /** Only populated on the PENDING batch — empty for ALLOCATED (historical) batches. */
    pendingTransactions: PendingAllocationTransaction[];
}

interface LoanAdvanceTransaction {
    transactionId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    amount: number;
    collectionDate: string;
    collectedByName: string;
}

interface LoanAdvanceBatch {
    batchNumber: number;
    status: 'ALLOCATED' | 'PENDING';
    amount: number;
    pendingTransactions: LoanAdvanceTransaction[];
}

/** Loan Advance (SAVINGS_COLLECTION) — allocated independently of any funder into the single
 *  shared LOAN ADVANCE ledger (see postEodLoanAdvanceAllocation), so it's one branch/date-wide
 *  bucket with its own "Allocate For EOD" action rather than a column on a funder's row. */
interface LoanAdvanceData {
    pendingAmount: number;
    postedAmount: number;
    totalAmount: number;
    overAllocated: boolean;
    mismatchAmount: number;
    batches: LoanAdvanceBatch[];
}

interface FunderAllocationRow {
    funderId: string | null;
    funderName: string;
    loanAdvanceUsed: number;
    penaltyAmount: number;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    /**
     * True when a collection was reverted after this funder's GL posting for the date, leaving
     * the posted amount above what current approved collections justify — the "already posted"
     * attribution can't be trusted in this state, so every current transaction is returned
     * instead of guessing which ones are covered. Needs a manual EOD Allocation Revert first.
     */
    overAllocated: boolean;
    mismatchAmount: number;
    /** Sequential allocation batches for this funder/date — 0..N ALLOCATED (one per historical
     *  "Allocate for EOD" click) followed by at most one trailing PENDING batch. */
    batches: AllocationBatch[];
}

interface ClosureTransactionRow {
    transactionId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    collectionDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    collectedByName: string;
}

interface ClosureAllocationBatch {
    batchNumber: number;
    status: 'ALLOCATED' | 'PENDING';
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    pendingTransactions: ClosureTransactionRow[];
}

/** Pre-Closure / Loan Closing funder row — same shape as FunderAllocationRow but without the
 *  penalty/loanAdvanceUsed columns (those don't apply to a full-payoff/write-off collection) and
 *  without overAllocated/mismatchAmount — unlike REPAYMENT there's no legacy posting history for
 *  these two types to ever drift out of sync with (see postEodClosureAllocation). */
interface ClosureAllocationRow {
    funderId: string | null;
    funderName: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    batches: ClosureAllocationBatch[];
    allocatedTransactions: ClosureTransactionRow[];
}

interface AllocationResponse {
    /** Combined, unsegregated REPAYMENT funder rows — kept for the Allocation Revert page
     *  (components/revert/AllocationRevertClient.tsx), which reads this field directly. Not
     *  rendered by this tab anymore — see demandRows/advanceRows/arrearRows below. */
    rows: FunderAllocationRow[];
    /** Same REPAYMENT money as `rows`, split three ways by collection mode. Each is funder-wise
     *  grouped, same shape as FunderAllocationRow — merged back together per funder (alongside
     *  preclosureRows/writeoffRows) by buildFunderGroups() below, so this tab renders one card
     *  per funder with Demand/Advance/Arrear/Pre-Closure/Loan Closing as labeled sub-sections
     *  inside it, rather than one section per type. */
    demandRows: FunderAllocationRow[];
    advanceRows: FunderAllocationRow[];
    arrearRows: FunderAllocationRow[];
    loanAdvance: LoanAdvanceData;
    preclosureRows: ClosureAllocationRow[];
    writeoffRows: ClosureAllocationRow[];
    summary: {
        principalAmount: number;
        interestAmount: number;
        loanAdvanceAmount: number;
        preclosureAmount: number;
        writeoffAmount: number;
        totalAmount: number;
    };
}

interface AllocateForEodTabProps {
    branchId: string;
    collectionDate: string;
    canAllocate: boolean;
    /** Bump this (e.g. after a collection is approved elsewhere on the page) to force a refetch. */
    refreshKey?: number;
}

/** One funder (Gold and Normal loans share the same bucket — gold is a loan-type flag, not a
 *  separate funder) with whichever of Demand/Advance/Arrear/Pre-Closure/Loan Closing has pending
 *  or allocated money for it on this date. Built by merging the five API-returned arrays (which
 *  already share the same funderId keying convention) — purely a client-side grouping, no
 *  backend change needed. */
interface FunderGroupData {
    funderId: string | null;
    funderName: string;
    demand?: FunderAllocationRow;
    advance?: FunderAllocationRow;
    arrear?: FunderAllocationRow;
    preclosure?: ClosureAllocationRow;
    writeoff?: ClosureAllocationRow;
}

function buildFunderGroups(data: AllocationResponse | null): FunderGroupData[] {
    if (!data) return [];
    const map = new Map<string, FunderGroupData>();
    const keyOf = (funderId: string | null) => funderId ?? 'OWN';
    const ensure = (funderId: string | null, funderName: string): FunderGroupData => {
        const key = keyOf(funderId);
        let group = map.get(key);
        if (!group) {
            group = { funderId, funderName };
            map.set(key, group);
        }
        return group;
    };
    for (const row of data.demandRows) ensure(row.funderId, row.funderName).demand = row;
    for (const row of data.advanceRows) ensure(row.funderId, row.funderName).advance = row;
    for (const row of data.arrearRows) ensure(row.funderId, row.funderName).arrear = row;
    for (const row of data.preclosureRows) ensure(row.funderId, row.funderName).preclosure = row;
    for (const row of data.writeoffRows) ensure(row.funderId, row.funderName).writeoff = row;
    return Array.from(map.values());
}

/** Shared batch table — S.No / Principal / Interest / Total / status. Used by both the
 *  Demand/Advance/Arrear and Pre-Closure/Loan Closing sub-sections. Display-only: allocation is
 *  now a single action for the whole funder (see the "Allocate For EOD" button on FunderGroupCard's
 *  header) rather than a per-type click, so a PENDING batch here just points up at that button. */
function BatchTable({
    batches,
    label,
}: {
    batches: Array<{
        batchNumber: number;
        status: 'ALLOCATED' | 'PENDING';
        principalAmount: number;
        interestAmount: number;
        totalAmount: number;
    }>;
    label: string;
}) {
    return (
        <div className="mt-2 space-y-3">
            {batches.map((batch) => (
                <div key={batch.batchNumber}>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                        {batch.batchNumber}. {label} &mdash;{' '}
                        {batch.status === 'ALLOCATED' ? (
                            <span className="text-emerald-700">Allocated</span>
                        ) : (
                            <span className="text-amber-700">Pending</span>
                        )}
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>S.No</TableHead>
                                <TableHead className="text-right">Principal</TableHead>
                                <TableHead className="text-right">Interest</TableHead>
                                <TableHead className="text-right">Total Amount</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell>{batch.batchNumber}</TableCell>
                                <TableCell className="text-right">{formatCurrency(batch.principalAmount)}</TableCell>
                                <TableCell className="text-right">{formatCurrency(batch.interestAmount)}</TableCell>
                                <TableCell className="text-right font-semibold text-sidebar-accent">
                                    {formatCurrency(batch.totalAmount)}
                                </TableCell>
                                <TableCell>
                                    {batch.status === 'ALLOCATED' ? (
                                        <span className="inline-flex items-center text-xs text-emerald-700 font-medium">
                                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Allocated
                                        </span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">Use Allocate For EOD above</span>
                                    )}
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            ))}
        </div>
    );
}

/** Demand / Advance / Arrear sub-section inside a funder's card — display only. */
function ModeSubBlock({ title, row }: { title: string; row: FunderAllocationRow }) {
    return (
        <div className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs font-semibold text-sidebar-accent uppercase tracking-wide">{title}</div>
                <div className="text-xs text-muted-foreground">
                    Loan Advance Used: {formatCurrency(row.loanAdvanceUsed)} &middot; Penalty: {formatCurrency(row.penaltyAmount)}
                </div>
            </div>

            {row.overAllocated && (
                <div className="mt-2 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                        GL posting for this funder/date is {formatCurrency(row.mismatchAmount)} higher than the
                        current approved collections below — most likely a collection was reverted after this
                        funder was already allocated. Revert the EOD allocation for this funder/date
                        (Admin → EOD Allocation Revert) before allocating again.
                    </span>
                </div>
            )}

            {row.batches.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                    Nothing to allocate for this funder yet.
                </div>
            ) : (
                <BatchTable batches={row.batches} label={title} />
            )}
        </div>
    );
}

/** Pre-Closure / Loan Closing sub-section inside a funder's card — display only. */
function ClosureSubBlock({ title, row }: { title: string; row: ClosureAllocationRow }) {
    return (
        <div className="px-4 py-3">
            <div className="text-xs font-semibold text-sidebar-accent uppercase tracking-wide">{title}</div>
            <BatchTable batches={row.batches} label={title} />
        </div>
    );
}

/** One card per funder — every collection type that has money for this funder on this date
 *  (Demand/Advance/Arrear/Pre-Closure/Loan Closing, Gold and Normal loans combined) shows as a
 *  labeled, display-only sub-section underneath a single "Funder: X" heading. Allocation is a
 *  single action for the whole funder/date: the "Allocate For EOD" button here posts one merged
 *  GL voucher pair (principal + interest) covering every pending item below, and finalizes any
 *  covered Pre-Closure/Loan Closing loans in the same step (see postEodFunderAllocation). */
function FunderGroupCard({
    group,
    canAllocate,
    processingKey,
    onAllocateMerged,
}: {
    group: FunderGroupData;
    canAllocate: boolean;
    processingKey: string | null;
    onAllocateMerged: (funderId: string | null) => void;
}) {
    const mergedKey = `MERGED:${group.funderId ?? 'OWN'}`;
    const hasPending = [group.demand, group.advance, group.arrear, group.preclosure, group.writeoff].some((row) =>
        row?.batches.some((b) => b.status === 'PENDING')
    );
    // Only Demand/Advance/Arrear carry the legacy-posting overAllocated guard (see
    // FunderAllocationRow) — Pre-Closure/Loan Closing have no pre-existing posting history to
    // ever drift out of sync with.
    const mergedOverAllocated = [group.demand, group.advance, group.arrear].some((row) => row?.overAllocated);
    // This funder/gold-flag already has an active merged voucher for the date — every row type
    // independently surfaces an ALLOCATED batch purely from eodAllocatedAt (no marker-scanning),
    // so this is reliable regardless of which type(s) the voucher covers. Lock the button entirely
    // in this case (not just when over-allocated) — a second click would layer another voucher
    // under the identical postingMarker instead of topping up the first one; the funder must be
    // fully reverted (Allocation Revert) before allocating again. Mirrored server-side in
    // POST /api/collections/eod-allocation's mergedFunderAllocation branch.
    const hasAnyAllocated = [group.demand, group.advance, group.arrear, group.preclosure, group.writeoff].some(
        (row) => row?.batches.some((b) => b.status === 'ALLOCATED')
    );

    return (
        <div className="rounded-lg border overflow-x-auto bg-white dark:bg-brand-green-darker/10">
            <div className="px-4 pt-3 pb-2 flex flex-wrap items-center justify-between gap-2 border-b">
                <div className="text-sm font-semibold text-sidebar-accent flex items-center gap-2">
                    Funder: {group.funderName}
                </div>
                {hasPending &&
                    (mergedOverAllocated || hasAnyAllocated ? (
                        <span className="text-xs text-red-600 font-medium">Revert EOD First</span>
                    ) : canAllocate ? (
                        <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                            disabled={!!processingKey}
                            onClick={() => onAllocateMerged(group.funderId)}
                        >
                            {processingKey === mergedKey ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Send className="mr-1 h-3.5 w-3.5" /> Allocate For EOD
                                </>
                            )}
                        </Button>
                    ) : null)}
            </div>
            <div className="divide-y">
                {group.demand && <ModeSubBlock title="Demand" row={group.demand} />}
                {group.advance && <ModeSubBlock title="Advance" row={group.advance} />}
                {group.arrear && <ModeSubBlock title="Arrear" row={group.arrear} />}
                {group.preclosure && <ClosureSubBlock title="Pre-Closure" row={group.preclosure} />}
                {group.writeoff && <ClosureSubBlock title="Loan Closing" row={group.writeoff} />}
            </div>
        </div>
    );
}

export function AllocateForEodTab({ branchId, collectionDate, canAllocate, refreshKey }: AllocateForEodTabProps) {
    const { toast } = useToast();
    const [data, setData] = useState<AllocationResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [processingKey, setProcessingKey] = useState<string | null>(null);
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();

    const fetchData = useCallback(async () => {
        if (!branchId || !collectionDate) return;
        setIsLoading(true);
        try {
            const result = await apiClient.get<AllocationResponse>(
                `/collections/eod-allocation?branchId=${branchId}&date=${collectionDate}`
            );
            if (result.success && result.data) {
                setData(result.data);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load EOD allocation data.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not connect to the server.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [branchId, collectionDate, toast]);

    useEffect(() => {
        fetchData();
        // refreshKey isn't read inside fetchData — it's a pure trigger so an approval made
        // elsewhere on the page (Demand/Advance/Arrear/Gold tabs) forces this tab's stale
        // APPROVED-but-not-yet-allocated data to reload without a manual page refresh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchData, refreshKey]);

    const handleAllocateMerged = async (funderId: string | null) => {
        const key = `MERGED:${funderId ?? 'OWN'}`;
        setProcessingKey(key);
        try {
            const result = await apiClient.post('/collections/eod-allocation', {
                branchId,
                date: collectionDate,
                funderId,
                // Merges every pending Demand/Advance/Arrear/Pre-Closure/Loan Closing item for
                // this funder/date into a single voucher pair — the server re-queries what's
                // actually pending rather than trusting a client-picked id list (same pattern
                // the closureType branch already uses).
                mergedFunderAllocation: true,
            });
            if (result.success) {
                toast({ title: 'Allocated', description: result.message || 'Allocated to EOD successfully.' });
                fetchData();
            } else {
                toast({ title: 'Allocation Failed', description: result.error || 'Please try again.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setProcessingKey(null);
        }
    };

    const handleAllocateLoanAdvance = async () => {
        const key = 'LOAN_ADVANCE';
        setProcessingKey(key);
        try {
            const result = await apiClient.post('/collections/eod-allocation/loan-advance', {
                branchId,
                date: collectionDate,
            });
            if (result.success) {
                toast({ title: 'Allocated', description: result.message || 'Loan Advance allocated to EOD successfully.' });
                fetchData();
            } else {
                toast({ title: 'Allocation Failed', description: result.error || 'Please try again.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setProcessingKey(null);
        }
    };

    // buildFunderGroups(null) safely returns [] — computing this (and calling the hook) before
    // the loading-state early return keeps hook order stable across renders.
    const funderGroups = buildFunderGroups(data);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedFunderGroups } = useTableSearch(funderGroups);

    if (isLoading && !data) {
        return <PageLoader label="Loading EOD allocation summary..." fullScreen={false} />;
    }

    return (
        <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-md text-amber-800 text-xs">
                Allocate for EOD should be done after all collections done and Approved.
            </div>

            {funderGroups.length > 0 && (
                <div className="flex justify-end">
                    <TableSearchInput
                        value={tableSearchQuery}
                        onChange={setTableSearchQuery}
                        placeholder="Search funders..."
                    />
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                    { label: 'Principal Amount', value: data?.summary.principalAmount ?? 0 },
                    { label: 'Interest Amount', value: data?.summary.interestAmount ?? 0 },
                    ...(loanAdvanceEnabled ? [{ label: 'Loan Advance Amount', value: data?.summary.loanAdvanceAmount ?? 0 }] : []),
                    { label: 'Pre-Closure Amount', value: data?.summary.preclosureAmount ?? 0 },
                    { label: 'Loan Closing Amount', value: data?.summary.writeoffAmount ?? 0 },
                    { label: 'Collection Amount', value: data?.summary.totalAmount ?? 0 },
                ].map((card) => (
                    <div key={card.label} className="bg-green-50 dark:bg-brand-green-darker/30 rounded-lg p-3 border border-primary/20">
                        <div className="text-xs text-primary font-medium">{card.label}</div>
                        <div className="text-lg font-bold text-sidebar-accent mt-1">{formatCurrency(card.value)}</div>
                    </div>
                ))}
            </div>

            {loanAdvanceEnabled && data?.loanAdvance && (
                <div className="rounded-lg border overflow-x-auto bg-white dark:bg-brand-green-darker/10">
                    <div className="px-4 pt-3 flex flex-wrap items-baseline justify-between gap-2">
                        <div className="text-sm font-semibold text-sidebar-accent">
                            Loan Advance
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Not funder-specific — client&apos;s own advance payment, posted to the shared LOAN ADVANCE ledger.
                        </div>
                    </div>

                    {data.loanAdvance.overAllocated && (
                        <div className="mx-4 mt-3 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>
                                GL posting for Loan Advance is {formatCurrency(data.loanAdvance.mismatchAmount)} higher
                                than the current approved collections below — most likely a collection was reverted
                                after this was already allocated. Revert the Loan Advance EOD allocation
                                (Admin → EOD Allocation Revert) before allocating again.
                            </span>
                        </div>
                    )}

                    {data.loanAdvance.batches.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                            Nothing to allocate for Loan Advance yet.
                        </div>
                    ) : (
                        data.loanAdvance.batches.map((batch) => (
                            <div key={batch.batchNumber} className="border-t first:border-t-0">
                                <div className="px-4 pt-3 text-xs font-semibold text-muted-foreground">
                                    {batch.batchNumber}. Loan Advance &mdash;{' '}
                                    {batch.status === 'ALLOCATED' ? (
                                        <span className="text-emerald-700">Allocated</span>
                                    ) : (
                                        <span className="text-amber-700">Pending</span>
                                    )}
                                </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>S.No</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead>Allocate For EOD</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        <TableRow>
                                            <TableCell>{batch.batchNumber}</TableCell>
                                            <TableCell className="text-right font-semibold text-sidebar-accent">
                                                {formatCurrency(batch.amount)}
                                            </TableCell>
                                            <TableCell>
                                                {batch.status === 'ALLOCATED' ? (
                                                    <span className="inline-flex items-center text-xs text-emerald-700 font-medium">
                                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Allocated
                                                    </span>
                                                ) : !data.loanAdvance.overAllocated ? (
                                                    canAllocate ? (
                                                        <Button
                                                            size="sm"
                                                            className="bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                                                            disabled={!!processingKey}
                                                            onClick={handleAllocateLoanAdvance}
                                                        >
                                                            {processingKey === 'LOAN_ADVANCE' ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <><Send className="mr-1 h-3.5 w-3.5" /> Allocate For EOD</>
                                                            )}
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )
                                                ) : (
                                                    <span className="text-xs text-red-600 font-medium">Revert EOD First</span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        ))
                    )}
                </div>
            )}

            {funderGroups.length === 0 && (
                <div className="rounded-lg border overflow-x-auto bg-white dark:bg-brand-green-darker/10 py-8 text-center text-muted-foreground">
                    No approved collections to allocate for this date.
                </div>
            )}

            {funderGroups.length > 0 && searchedFunderGroups.length === 0 && (
                <div className="rounded-lg border overflow-x-auto bg-white dark:bg-brand-green-darker/10 py-8 text-center text-muted-foreground">
                    No funders match your search.
                </div>
            )}

            {searchedFunderGroups.map((group) => (
                <FunderGroupCard
                    key={group.funderId ?? 'OWN'}
                    group={group}
                    canAllocate={canAllocate}
                    processingKey={processingKey}
                    onAllocateMerged={handleAllocateMerged}
                />
            ))}
        </div>
    );
}
