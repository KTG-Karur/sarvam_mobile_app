'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RevertLocationPicker, type RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
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
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, ArrowRight, Calendar, Loader2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { format } from 'date-fns';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type BranchLock = { id: string; branchId: string; branchCode: string; branchName: string; currentWorkingDate: string };

interface EodRevertHistoryRow {
    id: string;
    branchCode: string;
    branchName: string;
    fromWorkingDate: string;
    toWorkingDate: string;
    mode: string;
    revertedAt: string;
    revertedByName: string;
    revertedByEmployeeId: string | null;
    revertReason: string;
    revertLocation: RevertLocationDto;
}

const MAX_REVERT_STEPS = 60;

function formatWorkingDate(dateString: string): string {
    if (!dateString) return 'N/A';
    return toDisplayDate(new Date(dateString));
}

/** Calendar date (YYYY-MM-DD) for `dateString` in Asia/Kolkata, for comparing against a target date. */
function toKolkataYmd(dateString: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(dateString));
}

/** Latest selectable target date: the day before `ymd` (plain calendar arithmetic, UTC-safe). */
function dayBeforeYmd(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    return prev.toISOString().slice(0, 10);
}

export function EodRevertClient() {
    const { toast } = useToast();
    const [branchLocks, setBranchLocks] = useState<BranchLock[]>([]);
    const [branchId, setBranchId] = useState('');
    const [reason, setReason] = useState('');
    const [revertLocation, setRevertLocation] = useState<RevertLocationValue | null>(null);
    // Bumped after each revert so the picker remounts and captures a fresh location.
    const [locationKey, setLocationKey] = useState(0);
    const [targetDate, setTargetDate] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(true);
    const [isReverting, setIsReverting] = useState(false);
    const [revertLog, setRevertLog] = useState<string[]>([]);

    // Separate filter: the revert form (default) vs. the reverted history view.
    const [showHistory, setShowHistory] = useState(false);
    const [historyRows, setHistoryRows] = useState<EodRevertHistoryRow[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const loadBranchLocks = () => {
        setIsLoadingBranches(true);
        apiClient
            .get<BranchLock[]>('/branches/lock')
            .then((result) => {
                if (result.success && result.data) {
                    setBranchLocks(result.data);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to load branches.', variant: 'destructive' });
                }
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
    };

    useEffect(() => {
        loadBranchLocks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchHistory = () => {
        if (!branchId) return;
        setIsLoadingHistory(true);
        apiClient
            .get<EodRevertHistoryRow[]>(`/utilities/eod-process/revert-history?branchId=${branchId}`)
            .then((result) => {
                setHistoryRows(result.success && Array.isArray(result.data) ? result.data : []);
            })
            .catch(() => {
                setHistoryRows([]);
                toast({ title: 'Error', description: 'Failed to load EOD revert history.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingHistory(false));
    };

    useEffect(() => {
        if (showHistory && branchId) {
            fetchHistory();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showHistory, branchId]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(historyRows);

    const selectedBranchLock = branchLocks.find((b) => b.branchId === branchId) || null;

    /**
     * Reopens one day at a time, in strict sequence (31 -> 30 -> 29 -> 28 -> ...), until the
     * selected target date is reached. Each step re-runs the backend's activity guard, so this
     * stops immediately — without applying any further steps — at the first day that still has
     * recorded activity; that day (and everything after it, working backward) must be cleared
     * via the other Revert screens before EOD Revert can continue past it.
     */
    const handleRevertToDate = async () => {
        if (!branchId) {
            toast({ title: 'Branch required', description: 'Select a branch first.', variant: 'destructive' });
            return;
        }
        if (!reason.trim()) {
            toast({ title: 'Reason required', description: 'Please enter a reason for reopening EOD.', variant: 'destructive' });
            return;
        }
        if (!revertLocation) {
            toast({ title: 'Location required', description: 'Capture your location before reverting EOD.', variant: 'destructive' });
            return;
        }
        if (!targetDate) {
            toast({ title: 'Target date required', description: 'Pick the date to revert back to.', variant: 'destructive' });
            return;
        }
        if (!selectedBranchLock) return;

        const startYmd = toKolkataYmd(selectedBranchLock.currentWorkingDate);
        if (targetDate >= startYmd) {
            toast({ title: 'Invalid date', description: `Target date must be before the current working date (${startYmd}).`, variant: 'destructive' });
            return;
        }

        setIsReverting(true);
        setRevertLog([startYmd]);
        let steps = 0;
        let lastYmd = startYmd;
        try {
            while (steps < MAX_REVERT_STEPS && lastYmd > targetDate) {
                const result = await apiClient.post<{ previousWorkingDateYmd: string }>('/utilities/eod-process/revert', {
                    branchId,
                    reason,
                    latitude: revertLocation.latitude,
                    longitude: revertLocation.longitude,
                    mode: 'CORRECTION',
                });
                if (!result.success || !result.data) {
                    toast({
                        title: `Blocked at ${lastYmd}`,
                        description: result.error || `Could not reopen ${lastYmd}. Revert that day's activity first, then continue.`,
                        variant: 'destructive',
                    });
                    return;
                }
                lastYmd = result.data.previousWorkingDateYmd;
                steps += 1;
                setRevertLog((prev) => [...prev, lastYmd]);
            }

            if (lastYmd === targetDate) {
                toast({ title: 'EOD Reopened', description: `Reverted ${steps} day(s) — working date is now ${lastYmd}.` });
                setReason('');
                setTargetDate('');
                setRevertLocation(null);
                setLocationKey((k) => k + 1);
            } else if (lastYmd < targetDate) {
                toast({
                    title: 'Landed on nearest working day',
                    description: `Reverted ${steps} day(s) to ${lastYmd} (Sundays are skipped, so this is the closest working day at or before ${targetDate}).`,
                });
                setReason('');
                setTargetDate('');
                setRevertLocation(null);
                setLocationKey((k) => k + 1);
            } else {
                toast({
                    title: 'Step limit reached',
                    description: `Reverted ${steps} day(s), stopped at ${lastYmd}. Run again to continue toward ${targetDate}.`,
                    variant: 'destructive',
                });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred while reverting.', variant: 'destructive' });
        } finally {
            setIsReverting(false);
            loadBranchLocks();
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-rose-600 to-red-700 bg-clip-text text-transparent">
                    EOD Revert
                </h1>
                <p className="text-muted-foreground mt-1">Reopen a branch&apos;s working day by rolling it back one day. Admin-only.</p>
            </div>

            <div className="max-w-2xl space-y-6">
                <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-semibold">This only reopens the day — it does not undo anything that happened during the close.</p>
                        <p className="mt-1">
                            It&apos;s blocked if any collection, voucher, meeting, or denomination entry is already recorded on the
                            branch&apos;s current working date. Revert that activity first if this fails.
                        </p>
                    </div>
                </div>

                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <div>
                            <Label className="mb-1.5 block">Branch</Label>
                            <Select value={branchId} onValueChange={setBranchId} disabled={isLoadingBranches}>
                                <SelectTrigger><SelectValue placeholder="Select Branch" /></SelectTrigger>
                                <SelectContent>
                                    {branchLocks.map((b) => (
                                        <SelectItem key={b.branchId} value={b.branchId}>{b.branchCode} - {b.branchName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
                            <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <div>
                                <p className="text-xs text-muted-foreground">Current working date</p>
                                {isLoadingBranches ? (
                                    <Loader2 className="h-4 w-4 animate-spin mt-1" />
                                ) : (
                                    <p className="text-lg font-semibold">
                                        {selectedBranchLock ? formatWorkingDate(selectedBranchLock.currentWorkingDate) : 'Select a branch'}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 border-t pt-4">
                            <Switch checked={showHistory} onCheckedChange={setShowHistory} />
                            <div>
                                <Label className="text-sm font-semibold">Show Reverted History</Label>
                                <p className="text-xs text-muted-foreground">
                                    {showHistory
                                        ? 'Viewing this branch’s EOD revert history — showing who reverted each one and when.'
                                        : 'Off shows the revert form. Turn on to view this branch’s reverted EOD history instead.'}
                                </p>
                            </div>
                        </div>

                        {!showHistory && (
                            <>
                                <div>
                                    <Label className="mb-1.5 block">Reason (required)</Label>
                                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is EOD being reopened?" />
                                </div>

                                <RevertLocationPicker key={locationKey} value={revertLocation} onChange={setRevertLocation} disabled={isReverting} />

                                <div>
                                    <Label className="mb-1.5 block">Revert to date (required)</Label>
                                    <DateInput
                                        value={targetDate}
                                        max={selectedBranchLock ? dayBeforeYmd(toKolkataYmd(selectedBranchLock.currentWorkingDate)) : undefined}
                                        onChange={(e) => setTargetDate(e.target.value)}
                                        disabled={isReverting || !selectedBranchLock}
                                    />
                                    <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                                        Correction mode: walks back one day at a time (e.g. 31 → 30 → 29 → 28) even through days
                                        that already have collections/vouchers/meetings — it does <strong>not</strong> touch or
                                        delete that data. After reaching the target day and making your correction there, you
                                        must move EOD forward day by day again (re-check, resubmit denomination, close) through
                                        every day you passed through before the branch returns to normal. Do this only when the
                                        branch is not actively taking new collections/vouchers, since new entries during this
                                        window get dated to whichever day is currently reopened.
                                    </p>
                                </div>

                                {revertLog.length > 1 && (
                                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
                                        {revertLog.map((ymd, i) => (
                                            <span key={ymd} className="flex items-center gap-1.5">
                                                {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                                <span className={i === revertLog.length - 1 ? 'font-semibold text-rose-600' : ''}>{ymd}</span>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="flex flex-wrap justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={handleRevertToDate}
                                        disabled={isReverting || !targetDate || !revertLocation}
                                    >
                                        {isReverting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                                        Revert to Date
                                    </Button>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            {showHistory && (
                <div className="flex flex-wrap items-center gap-4">
                    <TableSearchInput
                        value={tableSearchQuery}
                        onChange={setTableSearchQuery}
                        placeholder="Search EOD revert history..."
                        className="ml-auto"
                    />
                </div>
            )}

            {showHistory && (
                <div className="rounded-lg border overflow-x-auto bg-white dark:bg-[#1a0505]/10">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Branch</TableHead>
                                <TableHead>From Working Date</TableHead>
                                <TableHead>To Working Date</TableHead>
                                <TableHead>Mode</TableHead>
                                <TableHead>Reverted By</TableHead>
                                <TableHead>Reverted On</TableHead>
                                <TableHead>Revert Reason</TableHead>
                                <TableHead>Revert Location</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingHistory ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8">
                                        <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading...
                                    </TableCell>
                                </TableRow>
                            ) : searchedRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                                        No reverted EOD history found for this branch.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                searchedRows.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="font-medium">{row.branchCode} - {row.branchName}</TableCell>
                                        <TableCell>{format(new Date(row.fromWorkingDate), 'dd/MM/yyyy')}</TableCell>
                                        <TableCell>{format(new Date(row.toWorkingDate), 'dd/MM/yyyy')}</TableCell>
                                        <TableCell className="text-xs">{row.mode}</TableCell>
                                        <TableCell className="text-xs">
                                            {row.revertedByName}
                                            {row.revertedByEmployeeId && (
                                                <span className="block text-muted-foreground">({row.revertedByEmployeeId})</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {format(new Date(row.revertedAt), 'dd/MM/yyyy hh:mm a')}
                                        </TableCell>
                                        <TableCell className="text-xs max-w-[220px] whitespace-pre-wrap break-words">
                                            {row.revertReason}
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
            )}
        </div>
    );
}
