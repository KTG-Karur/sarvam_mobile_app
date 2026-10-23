'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { Loader2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { RevertLocationPicker, type RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
import { formatCurrency } from '@/components/approval/collection-modes/types';
import { Switch } from '@/components/ui/switch';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

type Branch = { id: string; name: string; code: string };

interface AllocatedTransaction {
    transactionId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
}

interface FunderAllocationRow {
    funderId: string | null;
    funderName: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    allocatedTransactions: AllocatedTransaction[];
}

/** Loan Advance (SAVINGS_COLLECTION) — not tied to any funder, allocated/reverted as a single
 *  branch/date-wide bucket (see postEodLoanAdvanceAllocation). */
interface LoanAdvanceAllocatedTransaction {
    transactionId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    amount: number;
}

interface LoanAdvanceData {
    totalAmount: number;
    allocatedTransactions: LoanAdvanceAllocatedTransaction[];
}

type RevertBucket =
    | {
        type: 'FUNDER';
        funderId: string | null;
        funderName: string;
        transactionIds: string[];
        total: number;
    }
    | {
        type: 'PRECLOSURE';
        funderId: string | null;
        funderName: string;
        transactionIds: string[];
        total: number;
    }
    | {
        type: 'WRITEOFF';
        funderId: string | null;
        funderName: string;
        transactionIds: string[];
        total: number;
    }
    | {
        type: 'LOAN_ADVANCE';
        transactionIds: string[];
        total: number;
    };

type PendingRevert =
    | (RevertBucket & { label: string })
    | {
        type: 'ALL';
        buckets: RevertBucket[];
        label: string;
        total: number;
    };

interface AllocationResponse {
    rows: FunderAllocationRow[];
    loanAdvance: LoanAdvanceData;
    preclosureRows: FunderAllocationRow[];
    writeoffRows: FunderAllocationRow[];
}

interface RevertedAllocationRow {
    funderId: string | null;
    funderName: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertedAt: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
}

interface RevertedLoanAdvanceRow {
    voucherNos: string[];
    amount: number;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertedAt: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
}

interface RevertedAllocationResponse {
    rows: RevertedAllocationRow[];
    loanAdvanceReverted: RevertedLoanAdvanceRow[];
    preclosureReverted: RevertedAllocationRow[];
    writeoffReverted: RevertedAllocationRow[];
}

/** One funder (Gold and Normal loans share the same bucket — gold is a loan-type flag, not a
 *  separate funder) with whichever of Demand/Advance/Arrear ("funder"), Pre-Closure, and Loan
 *  Closing has an active allocation for it — merged client-side from the three separately-typed
 *  arrays the API returns (rows/preclosureRows/writeoffRows), which already share the same
 *  funderId keying convention. Mirrors buildFunderGroups in
 *  components/approval/collection-modes/AllocateForEodTab.tsx: a funder's day can be one merged
 *  "Allocate for EOD" voucher covering all three types, so it should read (and revert) as one card
 *  here too, instead of a separate card per type. */
type FunderGroupData = {
    funderId: string | null;
    funderName: string;
    funder?: FunderAllocationRow;
    preclosure?: FunderAllocationRow;
    writeoff?: FunderAllocationRow;
};

function buildFunderGroups(
    rows: FunderAllocationRow[],
    preclosureRows: FunderAllocationRow[],
    writeoffRows: FunderAllocationRow[]
): FunderGroupData[] {
    const map = new Map<string, FunderGroupData>();
    const keyOf = (funderId: string | null) => funderId ?? 'OWN';
    const ensure = (row: FunderAllocationRow): FunderGroupData => {
        const key = keyOf(row.funderId);
        let group = map.get(key);
        if (!group) {
            group = { funderId: row.funderId, funderName: row.funderName };
            map.set(key, group);
        }
        return group;
    };
    for (const row of rows.filter((r) => r.allocatedTransactions.length > 0)) ensure(row).funder = row;
    for (const row of preclosureRows.filter((r) => r.allocatedTransactions.length > 0)) ensure(row).preclosure = row;
    for (const row of writeoffRows.filter((r) => r.allocatedTransactions.length > 0)) ensure(row).writeoff = row;
    return Array.from(map.values());
}

/** Every sub-type a funder group has active money in, as its own RevertBucket — reverting the
 *  group means reverting all of them together (see the 'ALL' pendingRevert type), the same way a
 *  merged voucher covers all three at once on the posting side. */
function bucketsForGroup(group: FunderGroupData): RevertBucket[] {
    const buckets: RevertBucket[] = [];
    if (group.funder) {
        buckets.push({
            type: 'FUNDER',
            funderId: group.funderId,
            funderName: group.funderName,
            transactionIds: group.funder.allocatedTransactions.map((t) => t.transactionId),
            total: group.funder.totalAmount,
        });
    }
    if (group.preclosure) {
        buckets.push({
            type: 'PRECLOSURE',
            funderId: group.funderId,
            funderName: group.funderName,
            transactionIds: group.preclosure.allocatedTransactions.map((t) => t.transactionId),
            total: group.preclosure.totalAmount,
        });
    }
    if (group.writeoff) {
        buckets.push({
            type: 'WRITEOFF',
            funderId: group.funderId,
            funderName: group.funderName,
            transactionIds: group.writeoff.allocatedTransactions.map((t) => t.transactionId),
            total: group.writeoff.totalAmount,
        });
    }
    return buckets;
}

const getTodayDate = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function AllocationRevertClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [date, setDate] = useState(getTodayDate());
    const [rows, setRows] = useState<FunderAllocationRow[]>([]);
    const [loanAdvance, setLoanAdvance] = useState<LoanAdvanceData | null>(null);
    const [preclosureRows, setPreclosureRows] = useState<FunderAllocationRow[]>([]);
    const [writeoffRows, setWriteoffRows] = useState<FunderAllocationRow[]>([]);
    const [revertedRows, setRevertedRows] = useState<RevertedAllocationRow[]>([]);
    const [loanAdvanceReverted, setLoanAdvanceReverted] = useState<RevertedLoanAdvanceRow[]>([]);
    const [preclosureReverted, setPreclosureReverted] = useState<RevertedAllocationRow[]>([]);
    const [writeoffReverted, setWriteoffReverted] = useState<RevertedAllocationRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Separate filter: Active allocations (default) vs. the reverted history view.
    const [showReverted, setShowReverted] = useState(false);

    const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(null);
    const [reason, setReason] = useState('');
    const [revertLocation, setRevertLocation] = useState<RevertLocationValue | null>(null);
    // Fresh location capture for every revert dialog.
    useEffect(() => {
        if (!pendingRevert) setRevertLocation(null);
    }, [pendingRevert]);
    const [isReverting, setIsReverting] = useState(false);

    useEffect(() => {
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                const list: Branch[] = (json?.data ?? []).map((b: Branch) => ({ id: b.id, name: b.name, code: b.code }));
                setBranches(list);
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchRows = useCallback(async () => {
        if (!branchId || !date) return;
        setIsLoading(true);
        try {
            if (showReverted) {
                const result = await apiClient.get<RevertedAllocationResponse>(`/collections/eod-allocation?branchId=${branchId}&date=${date}&status=reverted`);
                if (result.success && result.data) {
                    setRevertedRows(result.data.rows);
                    setLoanAdvanceReverted(result.data.loanAdvanceReverted);
                    setPreclosureReverted(result.data.preclosureReverted);
                    setWriteoffReverted(result.data.writeoffReverted);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to load reverted allocations.', variant: 'destructive' });
                }
            } else {
                const result = await apiClient.get<AllocationResponse>(`/collections/eod-allocation?branchId=${branchId}&date=${date}`);
                if (result.success && result.data) {
                    setRows(result.data.rows);
                    setLoanAdvance(result.data.loanAdvance);
                    setPreclosureRows(result.data.preclosureRows);
                    setWriteoffRows(result.data.writeoffRows);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to load allocations.', variant: 'destructive' });
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [branchId, date, showReverted, toast]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(revertedRows);

    const revertBucket = (bucket: RevertBucket, reasonText: string, location: RevertLocationValue) => {
        const endpoint = bucket.type === 'LOAN_ADVANCE'
            ? '/collections/eod-allocation/loan-advance/revert'
            : '/collections/eod-allocation/revert';
        return apiClient.post(endpoint, {
            branchId,
            date,
            reason: reasonText,
            latitude: location.latitude,
            longitude: location.longitude,
            transactionIds: bucket.transactionIds,
            ...(bucket.type === 'FUNDER' || bucket.type === 'PRECLOSURE' || bucket.type === 'WRITEOFF'
                ? { funderId: bucket.funderId }
                : {}),
            ...(bucket.type === 'PRECLOSURE' ? { closureType: 'PRECLOSURE' } : {}),
        });
    };

    const bucketLabel = (bucket: RevertBucket) =>
        bucket.type === 'LOAN_ADVANCE'
            ? 'Loan Advance'
            : bucket.type === 'PRECLOSURE'
                ? `${bucket.funderName} (Pre-Closure)`
                : bucket.type === 'WRITEOFF'
                    ? `${bucket.funderName} (Loan Closing)`
                    : bucket.funderName;

    const doRevert = async () => {
        if (!pendingRevert) return;
        if (!revertLocation) {
            toast({ title: 'Location required', description: 'Capture your location before reverting.', variant: 'destructive' });
            return;
        }
        if (!reason.trim()) {
            toast({ title: 'Reason required', description: 'Please enter a reason for reverting this allocation.', variant: 'destructive' });
            return;
        }
        setIsReverting(true);
        try {
            if (pendingRevert.type === 'ALL') {
                let successCount = 0;
                const failures: string[] = [];
                for (const bucket of pendingRevert.buckets) {
                    const result = await revertBucket(bucket, reason, revertLocation);
                    if (result.success) successCount++;
                    else failures.push(bucketLabel(bucket));
                }
                if (failures.length === 0) {
                    toast({ title: 'Reverted', description: `All ${successCount} allocation(s) reverted successfully.` });
                } else if (successCount > 0) {
                    toast({ title: 'Partially Reverted', description: `Reverted ${successCount} of ${pendingRevert.buckets.length}. Failed: ${failures.join(', ')}.`, variant: 'destructive' });
                } else {
                    toast({ title: 'Revert Failed', description: `Failed: ${failures.join(', ')}.`, variant: 'destructive' });
                }
                setPendingRevert(null);
                setReason('');
                fetchRows();
                return;
            }

            const result = await revertBucket(pendingRevert, reason, revertLocation);
            if (result.success) {
                toast({ title: 'Reverted', description: result.message || 'Allocation reverted successfully.' });
                setPendingRevert(null);
                setReason('');
                fetchRows();
            } else {
                toast({ title: 'Revert Failed', description: result.error || 'Please try again.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    const allBuckets: RevertBucket[] = [
        ...(loanAdvance?.allocatedTransactions.length
            ? [{ type: 'LOAN_ADVANCE' as const, transactionIds: loanAdvance.allocatedTransactions.map((t) => t.transactionId), total: loanAdvance.totalAmount }]
            : []),
        ...rows
            .filter((row) => row.allocatedTransactions.length > 0)
            .map((row) => ({
                type: 'FUNDER' as const,
                funderId: row.funderId,
                funderName: row.funderName,
                transactionIds: row.allocatedTransactions.map((t) => t.transactionId),
                total: row.totalAmount,
            })),
        ...preclosureRows
            .filter((row) => row.allocatedTransactions.length > 0)
            .map((row) => ({
                type: 'PRECLOSURE' as const,
                funderId: row.funderId,
                funderName: row.funderName,
                transactionIds: row.allocatedTransactions.map((t) => t.transactionId),
                total: row.totalAmount,
            })),
        ...writeoffRows
            .filter((row) => row.allocatedTransactions.length > 0)
            .map((row) => ({
                type: 'WRITEOFF' as const,
                funderId: row.funderId,
                funderName: row.funderName,
                transactionIds: row.allocatedTransactions.map((t) => t.transactionId),
                total: row.totalAmount,
            })),
    ];
    const allBucketsTotal = allBuckets.reduce((sum, b) => sum + b.total, 0);
    const funderGroups = buildFunderGroups(rows, preclosureRows, writeoffRows);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-rose-600 to-red-700 bg-clip-text text-transparent">
                    Allocation Revert
                </h1>
                <p className="text-muted-foreground mt-1">Undo a funder&apos;s &quot;Allocate for EOD&quot; posting so its collections can be re-allocated. Admin-only.</p>
            </div>

            <Card>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <Label className="mb-1.5 block">Date</Label>
                            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
                        </div>
                        <div>
                            <Label className="mb-1.5 block">Branch</Label>
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger><SelectValue placeholder="Select Branch" /></SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <Switch checked={showReverted} onCheckedChange={setShowReverted} />
                            <div>
                                <Label className="text-sm font-semibold">Show Reverted Allocations</Label>
                                <p className="text-xs text-muted-foreground">
                                    {showReverted
                                        ? 'Viewing reverted allocations — showing who reverted each one and when.'
                                        : 'Off shows current allocations. Turn on to view the reverted history instead.'}
                                </p>
                            </div>
                        </div>
                        <Button onClick={fetchRows} disabled={isLoading}>
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Submit
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {showReverted ? (
                <div className="space-y-4">
                    {loanAdvanceReverted.length > 0 && (
                        <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold">Loan Advance</div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>S.No</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead>Reverted By</TableHead>
                                        <TableHead>Reverted On</TableHead>
                                        <TableHead>Revert Reason</TableHead>
                                        <TableHead>Revert Location</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loanAdvanceReverted.map((row, idx) => (
                                        <TableRow key={row.revertedAt ?? idx}>
                                            <TableCell>{idx + 1}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.amount)}</TableCell>
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
                    )}
                    <div className="flex flex-wrap items-center gap-4">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search reverted allocations..."
                            className="ml-auto"
                        />
                    </div>
                    <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>S.No</TableHead>
                                    <TableHead>Funder Name</TableHead>
                                    <TableHead className="text-right">Principal</TableHead>
                                    <TableHead className="text-right">Interest</TableHead>
                                    <TableHead className="text-right">Total Amount</TableHead>
                                    <TableHead>Reverted By</TableHead>
                                    <TableHead>Reverted On</TableHead>
                                    <TableHead>Revert Reason</TableHead>
                                    <TableHead>Revert Location</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center py-8">
                                            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
                                        </TableCell>
                                    </TableRow>
                                ) : searchedRows.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                                            No reverted allocations found for this branch/date.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    revertedRows.map((row, idx) => (
                                        <TableRow key={`${row.funderId ?? 'OWN'}:${row.revertedAt ?? idx}`}>
                                            <TableCell>{idx + 1}</TableCell>
                                            <TableCell>{row.funderName}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.principalAmount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.interestAmount)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.totalAmount)}</TableCell>
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
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {preclosureReverted.length > 0 && (
                        <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold">Pre-Closure</div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>S.No</TableHead>
                                        <TableHead>Funder Name</TableHead>
                                        <TableHead className="text-right">Principal</TableHead>
                                        <TableHead className="text-right">Interest</TableHead>
                                        <TableHead className="text-right">Total Amount</TableHead>
                                        <TableHead>Reverted By</TableHead>
                                        <TableHead>Reverted On</TableHead>
                                        <TableHead>Revert Reason</TableHead>
                                        <TableHead>Revert Location</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {preclosureReverted.map((row, idx) => (
                                        <TableRow key={`preclosure:${row.funderId ?? 'OWN'}:${row.revertedAt ?? idx}`}>
                                            <TableCell>{idx + 1}</TableCell>
                                            <TableCell>{row.funderName}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.principalAmount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.interestAmount)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.totalAmount)}</TableCell>
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
                    )}
                    {writeoffReverted.length > 0 && (
                        <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold">Loan Closing</div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>S.No</TableHead>
                                        <TableHead>Funder Name</TableHead>
                                        <TableHead className="text-right">Principal</TableHead>
                                        <TableHead className="text-right">Interest</TableHead>
                                        <TableHead className="text-right">Total Amount</TableHead>
                                        <TableHead>Reverted By</TableHead>
                                        <TableHead>Reverted On</TableHead>
                                        <TableHead>Revert Reason</TableHead>
                                        <TableHead>Revert Location</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {writeoffReverted.map((row, idx) => (
                                        <TableRow key={`writeoff:${row.funderId ?? 'OWN'}:${row.revertedAt ?? idx}`}>
                                            <TableCell>{idx + 1}</TableCell>
                                            <TableCell>{row.funderName}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.principalAmount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.interestAmount)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.totalAmount)}</TableCell>
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
                    )}
                </div>
            ) : isLoading ? (
                <div className="rounded-lg border bg-white dark:bg-[#1a0505]/10 py-8 text-center">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
                </div>
            ) : rows.every((r) => r.allocatedTransactions.length === 0)
                && preclosureRows.every((r) => r.allocatedTransactions.length === 0)
                && writeoffRows.every((r) => r.allocatedTransactions.length === 0)
                && !loanAdvance?.allocatedTransactions.length ? (
                <div className="rounded-lg border bg-white dark:bg-[#1a0505]/10 py-8 text-center text-muted-foreground">
                    No allocated collections found for this branch/date.
                </div>
            ) : (
                <div className="space-y-4">
                    {allBuckets.length > 1 && (
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50/60 dark:bg-rose-950/10 px-4 py-3">
                            <div className="text-sm">
                                <span className="font-semibold">All Allocations</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {allBuckets.length} allocation{allBuckets.length > 1 ? 's' : ''} (Loan Advance + funders) · {formatCurrency(allBucketsTotal)}
                                </span>
                            </div>
                            <Button
                                size="sm"
                                className="bg-rose-600 hover:bg-rose-700 text-white"
                                onClick={() => setPendingRevert({
                                    type: 'ALL',
                                    buckets: allBuckets,
                                    label: `all ${allBuckets.length} allocations`,
                                    total: allBucketsTotal,
                                })}
                            >
                                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Revert All Allocations
                            </Button>
                        </div>
                    )}
                    {!!loanAdvance?.allocatedTransactions.length && (
                        <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-muted/30">
                                <div>
                                    <span className="font-semibold">Loan Advance</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {loanAdvance.allocatedTransactions.length} client{loanAdvance.allocatedTransactions.length > 1 ? 's' : ''} allocated · {formatCurrency(loanAdvance.totalAmount)}
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                    onClick={() => setPendingRevert({
                                        type: 'LOAN_ADVANCE',
                                        transactionIds: loanAdvance.allocatedTransactions.map((t) => t.transactionId),
                                        label: `All ${loanAdvance.allocatedTransactions.length} client${loanAdvance.allocatedTransactions.length > 1 ? 's' : ''}`,
                                        total: loanAdvance.totalAmount,
                                    })}
                                >
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Revert All
                                </Button>
                            </div>
                        </div>
                    )}
                    {funderGroups.map((group) => {
                        const buckets = bucketsForGroup(group);
                        const total = buckets.reduce((sum, b) => sum + b.total, 0);
                        const totalClients =
                            (group.funder?.allocatedTransactions.length ?? 0) +
                            (group.preclosure?.allocatedTransactions.length ?? 0) +
                            (group.writeoff?.allocatedTransactions.length ?? 0);
                        return (
                            <div
                                key={group.funderId ?? 'OWN'}
                                className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10"
                            >
                                <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-muted/30">
                                    <div>
                                        <span className="font-semibold">{group.funderName}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">
                                            {totalClients} client{totalClients > 1 ? 's' : ''} allocated · {formatCurrency(total)}
                                        </span>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                        onClick={() => setPendingRevert({
                                            type: 'ALL',
                                            buckets,
                                            label: `${group.funderName}'s allocation`,
                                            total,
                                        })}
                                    >
                                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Revert All
                                    </Button>
                                </div>
                                <div className="divide-y">
                                    {group.funder && (
                                        <div className="px-4 py-2.5 flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">Demand / Advance / Arrear</span>
                                            <span className="font-medium">
                                                {group.funder.allocatedTransactions.length} client{group.funder.allocatedTransactions.length > 1 ? 's' : ''} · {formatCurrency(group.funder.totalAmount)}
                                            </span>
                                        </div>
                                    )}
                                    {group.preclosure && (
                                        <div className="px-4 py-2.5 flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">Pre-Closure</span>
                                            <span className="font-medium">
                                                {group.preclosure.allocatedTransactions.length} client{group.preclosure.allocatedTransactions.length > 1 ? 's' : ''} · {formatCurrency(group.preclosure.totalAmount)}
                                            </span>
                                        </div>
                                    )}
                                    {group.writeoff && (
                                        <div className="px-4 py-2.5 flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">Loan Closing</span>
                                            <span className="font-medium">
                                                {group.writeoff.allocatedTransactions.length} client{group.writeoff.allocatedTransactions.length > 1 ? 's' : ''} · {formatCurrency(group.writeoff.totalAmount)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Dialog open={!!pendingRevert} onOpenChange={(open) => !open && setPendingRevert(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirm Allocation Revert</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        {pendingRevert?.type === 'ALL' ? (
                            <div className="text-sm text-muted-foreground space-y-2">
                                <p>
                                    This will revert{' '}
                                    <span className="font-medium text-foreground">
                                        {pendingRevert.buckets.length === 1 ? pendingRevert.label : `all ${pendingRevert.buckets.length} allocations`}
                                    </span>{' '}
                                    on {date} ({formatCurrency(pendingRevert.total)} total), making{' '}
                                    {pendingRevert.buckets.length === 1 ? 'it' : 'them'} re-allocatable:
                                </p>
                                <ul className="list-disc pl-5 space-y-0.5">
                                    {pendingRevert.buckets.map((b) => (
                                        <li key={b.type === 'LOAN_ADVANCE' ? 'LOAN_ADVANCE' : `${b.type}:${b.funderId ?? 'OWN'}`}>
                                            {bucketLabel(b)} — {formatCurrency(b.total)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                This will revert <span className="font-medium">{pendingRevert?.label}</span> from{' '}
                                <span className="font-medium">
                                    {pendingRevert?.type === 'FUNDER' || pendingRevert?.type === 'PRECLOSURE' || pendingRevert?.type === 'WRITEOFF'
                                        ? `${pendingRevert.funderName}'s${pendingRevert.type === 'PRECLOSURE' ? ' pre-closure' : pendingRevert.type === 'WRITEOFF' ? ' loan closing' : ''} allocation`
                                        : 'the Loan Advance allocation'}
                                </span> on {date}
                                {' '}({pendingRevert ? formatCurrency(pendingRevert.total) : ''}), making it re-allocatable.
                            </p>
                        )}
                        <div>
                            <Label className="mb-1.5 block">Reason (required)</Label>
                            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this allocation being reverted?" />
                        </div>
                        {pendingRevert && (
                            <RevertLocationPicker value={revertLocation} onChange={setRevertLocation} disabled={isReverting} />
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPendingRevert(null)} disabled={isReverting}>Cancel</Button>
                        <Button
                            className="bg-rose-600 hover:bg-rose-700 text-white"
                            onClick={doRevert}
                            disabled={isReverting || !revertLocation}
                        >
                            {isReverting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {pendingRevert?.type === 'ALL' ? 'Revert All' : 'Revert Allocation'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
