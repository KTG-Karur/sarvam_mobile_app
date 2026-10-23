'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { RevertReasonDialog } from '@/components/revert/RevertReasonDialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { ClipboardList, ChevronDown, ChevronRight, Loader2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toDisplayDateTime } from '@/app/lib/date-format';

interface UploanImportJobSummary {
    id: string;
    branchName: string;
    branchCode: string;
    createdByName: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERTING' | 'REVERTED';
    totalRows: number;
    createdCount: number;
    failedCount: number;
    revertedCount: number;
    revertFailedCount: number;
    createdAt: string;
    completedAt: string | null;
    canRevert: boolean;
    revertReason: string | null;
    revertedAt: string | null;
    revertedByName: string | null;
}

interface UploanImportJobRowView {
    id: string;
    rowId: string;
    name: string;
    mobileNumber: string;
    status: 'PENDING' | 'CREATED' | 'FAILED' | 'REVERT_PENDING' | 'REVERTED' | 'REVERT_FAILED';
    reason?: string;
    clientId?: string;
    loanNumber?: string;
    canRevert: boolean;
    revertReason?: string;
    revertedAt?: string;
    revertedByName?: string;
}

const STATUS_BADGE: Record<string, string> = {
    PENDING: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    PROCESSING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    REVERTING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    REVERTED: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

type ImportKind = 'member' | 'closed-member';

const KIND_LABELS: Record<ImportKind, { tab: string; title: string; description: string }> = {
    member: {
        tab: 'Member Imports',
        title: 'Import History',
        description:
            "Past bulk uploan member imports. A completed import can be reverted within 7 days of completing — undoing everything it created for members that haven't since had real activity recorded against their loan.",
    },
    'closed-member': {
        tab: 'Closed Member Imports',
        title: 'Closed Member Import History',
        description:
            "Past Closed Loan Member Upload imports. A completed import can be reverted within 7 days of completing — undoing everything it created, except any row whose Savings Refund / Gold Return request has since been approved or rejected, or whose loan has otherwise received real activity.",
    },
};

export function UploanImportHistoryClient() {
    const { toast } = useToast();
    const [kind, setKind] = useState<ImportKind>('member');
    const apiBase = kind === 'member' ? '/uploan/member' : '/uploan/closed-member';

    const [jobs, setJobs] = useState<UploanImportJobSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
    const [rowsByJobId, setRowsByJobId] = useState<Record<string, UploanImportJobRowView[]>>({});
    const [loadingRowsFor, setLoadingRowsFor] = useState<string | null>(null);

    const [revertDialogJob, setRevertDialogJob] = useState<UploanImportJobSummary | null>(null);
    const [isReverting, setIsReverting] = useState(false);

    const [revertDialogRow, setRevertDialogRow] = useState<{ jobId: string; row: UploanImportJobRowView } | null>(null);
    const [isRevertingRow, setIsRevertingRow] = useState(false);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [pollingJobId, setPollingJobId] = useState<string | null>(null);

    const fetchJobs = useCallback(async (targetPage: number) => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<{
                jobs: UploanImportJobSummary[];
                totalPages: number;
                totalCount: number;
            }>(`${apiBase}/import/jobs?page=${targetPage}&pageSize=20`);
            if (result.success && result.data) {
                setJobs(result.data.jobs);
                setTotalPages(result.data.totalPages);
                setTotalCount(result.data.totalCount);
            }
        } finally {
            setIsLoading(false);
        }
    }, [apiBase]);

    useEffect(() => {
        fetchJobs(page);
    }, [page, fetchJobs]);

    // Switching tabs is a fresh list, not a filter on the same one — reset paging/expansion
    // state so stale rows from the other import type never bleed through.
    useEffect(() => {
        setPage(1);
        setExpandedJobId(null);
        setRowsByJobId({});
        setPollingJobId(null);
    }, [kind]);

    const fetchRowsForJob = useCallback(async (jobId: string, silent = false) => {
        if (!silent) setLoadingRowsFor(jobId);
        try {
            const result = await apiClient.get<{ status: string; rows: UploanImportJobRowView[] }>(
                `${apiBase}/import/status?jobId=${jobId}`
            );
            if (result.success && result.data) {
                setRowsByJobId((prev) => ({ ...prev, [jobId]: result.data!.rows }));
                return result.data;
            }
        } finally {
            if (!silent) setLoadingRowsFor(null);
        }
        return null;
    }, [apiBase]);

    const toggleExpand = async (job: UploanImportJobSummary) => {
        if (expandedJobId === job.id) {
            setExpandedJobId(null);
            return;
        }
        setExpandedJobId(job.id);
        if (!rowsByJobId[job.id]) {
            await fetchRowsForJob(job.id);
        }
    };

    // Poll while a revert is in flight — covers both a whole-job revert (job reaches
    // REVERTED) and a per-member revert (job stays COMPLETED; stop once no row is left
    // in REVERT_PENDING). Refreshes both the row list and the job summary table.
    useEffect(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (!pollingJobId) return;
        const jobId = pollingJobId;

        pollRef.current = setInterval(async () => {
            const data = await fetchRowsForJob(jobId, true);
            if (!data) return;
            const stillReverting = data.rows.some((r) => r.status === 'REVERT_PENDING');
            if (data.status === 'REVERTED' || !stillReverting) {
                setPollingJobId(null);
                fetchJobs(page);
                toast({ title: 'Revert complete', description: 'The revert has finished.' });
            }
        }, 3000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pollingJobId]);

    const handleRevert = async (reason: string) => {
        if (!revertDialogJob) return;
        setIsReverting(true);
        try {
            const result = await apiClient.post<{ revertingCount: number; skippedCount: number }>(
                `${apiBase}/import/${revertDialogJob.id}/revert`,
                { reason }
            );
            if (!result.success) {
                toast({ title: 'Revert failed', description: result.error || 'Could not start revert', variant: 'destructive' });
                return;
            }
            toast({
                title: 'Revert started',
                description: result.data?.skippedCount
                    ? `Reverting ${result.data.revertingCount} row(s); ${result.data.skippedCount} skipped (real activity since import).`
                    : `Reverting ${result.data?.revertingCount ?? 0} row(s) in the background.`,
            });
            setExpandedJobId(revertDialogJob.id);
            await fetchJobs(page);
            // Kick the poll loop immediately rather than waiting for the first interval tick.
            const revertedJobId = revertDialogJob.id;
            setRevertDialogJob(null);
            await fetchRowsForJob(revertedJobId, true);
            setPollingJobId(revertedJobId);
        } catch {
            toast({ title: 'Revert failed', description: 'Could not start revert', variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    const handleRevertRow = async (reason: string) => {
        if (!revertDialogRow) return;
        const { jobId, row } = revertDialogRow;
        setIsRevertingRow(true);
        try {
            const result = await apiClient.post<{ jobId: string; rowId: string }>(
                `${apiBase}/import/${jobId}/rows/${row.id}/revert`,
                { reason }
            );
            if (!result.success) {
                toast({ title: 'Member revert failed', description: result.error || 'Could not start revert', variant: 'destructive' });
                return;
            }
            toast({ title: 'Member revert started', description: `Reverting ${row.name || 'this member'} in the background.` });
            setExpandedJobId(jobId);
            setRevertDialogRow(null);
            await fetchRowsForJob(jobId, true);
            setPollingJobId(jobId);
        } catch {
            toast({ title: 'Member revert failed', description: 'Could not start revert', variant: 'destructive' });
        } finally {
            setIsRevertingRow(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ClipboardList className="h-5 w-5" />
                        {KIND_LABELS[kind].title}
                    </CardTitle>
                    <CardDescription>{KIND_LABELS[kind].description}</CardDescription>
                    <div className="flex gap-1 pt-2">
                        {(Object.keys(KIND_LABELS) as ImportKind[]).map((k) => (
                            <Button
                                key={k}
                                type="button"
                                size="sm"
                                variant={kind === k ? 'default' : 'outline'}
                                onClick={() => setKind(k)}
                            >
                                {KIND_LABELS[k].tab}
                            </Button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading && jobs.length === 0 ? (
                        <div className="flex items-center justify-center py-12 text-slate-500">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
                        </div>
                    ) : jobs.length === 0 ? (
                        <p className="text-sm text-slate-500 py-8 text-center">No import jobs yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-8" />
                                        <TableHead>Branch</TableHead>
                                        <TableHead>Created By</TableHead>
                                        <TableHead>Created At</TableHead>
                                        <TableHead className="text-right">Rows</TableHead>
                                        <TableHead className="text-right">Created</TableHead>
                                        <TableHead className="text-right">Failed</TableHead>
                                        <TableHead className="text-right">Reverted</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {jobs.map((job) => (
                                        <React.Fragment key={job.id}>
                                            <TableRow className="cursor-pointer hover:bg-slate-50 dark:hover:bg-sidebar-accent/30" onClick={() => toggleExpand(job)}>
                                                <TableCell>
                                                    {expandedJobId === job.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                </TableCell>
                                                <TableCell className="text-sm font-medium">{job.branchName} ({job.branchCode})</TableCell>
                                                <TableCell className="text-sm">{job.createdByName}</TableCell>
                                                <TableCell className="text-sm">{toDisplayDateTime(new Date(job.createdAt))}</TableCell>
                                                <TableCell className="text-right text-sm">{job.totalRows}</TableCell>
                                                <TableCell className="text-right text-sm text-emerald-700 dark:text-emerald-400">{job.createdCount}</TableCell>
                                                <TableCell className="text-right text-sm text-red-600">{job.failedCount}</TableCell>
                                                <TableCell className="text-right text-sm">{job.revertedCount}</TableCell>
                                                <TableCell>
                                                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[job.status] ?? '')}>
                                                        {job.status}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                    {job.canRevert ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                            onClick={() => setRevertDialogJob(job)}
                                                        >
                                                            <Undo2 className="h-3.5 w-3.5 mr-1" />
                                                            Revert
                                                        </Button>
                                                    ) : job.status === 'COMPLETED' ? (
                                                        <span className="text-xs text-slate-400" title="Only revertable within 7 days of completing">
                                                            Not revertable
                                                        </span>
                                                    ) : null}
                                                </TableCell>
                                            </TableRow>
                                            {expandedJobId === job.id && (
                                                <TableRow>
                                                    <TableCell colSpan={10} className="bg-slate-50/50 dark:bg-sidebar-accent/20 p-4">
                                                        {job.revertReason && (
                                                            <p className="text-xs text-slate-500 mb-3">
                                                                Revert reason ({job.revertedByName}, {job.revertedAt ? toDisplayDateTime(new Date(job.revertedAt)) : ''}): {job.revertReason}
                                                            </p>
                                                        )}
                                                        {loadingRowsFor === job.id ? (
                                                            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
                                                                <Loader2 className="h-4 w-4 animate-spin" /> Loading rows...
                                                            </div>
                                                        ) : (
                                                            <Table>
                                                                <TableHeader>
                                                                    <TableRow>
                                                                        <TableHead>Name</TableHead>
                                                                        <TableHead>Mobile</TableHead>
                                                                        <TableHead>Loan No.</TableHead>
                                                                        <TableHead>Status</TableHead>
                                                                        <TableHead>Reason</TableHead>
                                                                        <TableHead className="text-right">Action</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {(rowsByJobId[job.id] ?? []).map((r) => (
                                                                        <TableRow key={r.id}>
                                                                            <TableCell className="text-sm">{r.name}</TableCell>
                                                                            <TableCell className="text-sm">{r.mobileNumber}</TableCell>
                                                                            <TableCell className="text-sm font-mono">{r.loanNumber ?? '—'}</TableCell>
                                                                            <TableCell>
                                                                                {r.status === 'CREATED' && r.reason ? (
                                                                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                                                                        SKIPPED (KEPT)
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[r.status] ?? 'bg-slate-100 text-slate-700')}>
                                                                                        {r.status}
                                                                                    </span>
                                                                                )}
                                                                            </TableCell>
                                                                            <TableCell className="text-xs text-slate-500">
                                                                                {r.revertReason && (
                                                                                    <span className="block text-slate-600 dark:text-slate-300">
                                                                                        Reverted{r.revertedByName ? ` by ${r.revertedByName}` : ''}: {r.revertReason}
                                                                                    </span>
                                                                                )}
                                                                                {r.reason ?? ''}
                                                                            </TableCell>
                                                                            <TableCell className="text-right">
                                                                                {r.canRevert ? (
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant="outline"
                                                                                        className="h-7 border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                                                        onClick={() => setRevertDialogRow({ jobId: job.id, row: r })}
                                                                                    >
                                                                                        <Undo2 className="h-3.5 w-3.5 mr-1" />
                                                                                        Revert
                                                                                    </Button>
                                                                                ) : r.status === 'REVERT_PENDING' ? (
                                                                                    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                                                                        <Loader2 className="h-3 w-3 animate-spin" /> Reverting…
                                                                                    </span>
                                                                                ) : null}
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                </TableBody>
                                                            </Table>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-1 py-3 mt-2">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Page {page} of {totalPages} · {totalCount} job{totalCount !== 1 ? 's' : ''}
                            </p>
                            <div className="flex gap-1">
                                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || isLoading}>
                                    Previous
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || isLoading}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <RevertReasonDialog
                requireLocation={false}
                open={revertDialogJob !== null}
                onOpenChange={(open) => { if (!open) setRevertDialogJob(null); }}
                title="Revert this import?"
                description={
                    revertDialogJob
                        ? `This will delete the clients, loans, schedules, transactions, gold records and co-applicants created by this import (${revertDialogJob.createdCount} member(s)) — except any loan that has since received real activity, which will be left untouched. This cannot be undone.`
                        : ''
                }
                isSubmitting={isReverting}
                onConfirm={handleRevert}
            />

            <RevertReasonDialog
                requireLocation={false}
                open={revertDialogRow !== null}
                onOpenChange={(open) => { if (!open) setRevertDialogRow(null); }}
                title="Revert this member?"
                description={
                    revertDialogRow
                        ? `This will delete the client, loan, schedule, transactions, gold records and co-applicant created for ${revertDialogRow.row.name || 'this member'}${revertDialogRow.row.loanNumber ? ` (loan ${revertDialogRow.row.loanNumber})` : ''}. The rest of the import is left untouched. This cannot be undone.`
                        : ''
                }
                isSubmitting={isRevertingRow}
                onConfirm={handleRevertRow}
            />
        </div>
    );
}
