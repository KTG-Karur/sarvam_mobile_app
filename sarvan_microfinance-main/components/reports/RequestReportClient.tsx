'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Calendar, RefreshCw, Download, Loader2, FileText, XCircle, RotateCcw } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { downloadStorageFile } from '@/app/lib/storage-url-client';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

type ReportRequestStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type ReportRequestRow = {
    id: string;
    requestId: string;
    reportSlug: string;
    reportName: string;
    branchLabel: string;
    requestedByName: string;
    fromDate: string | null;
    toDate: string | null;
    fileFormat: 'EXCEL' | 'PDF' | 'CSV';
    status: ReportRequestStatus;
    progressPercent: number;
    totalCount: number;
    storageKey: string | null;
    errorMessage: string | null;
    requestedAt: string;
    completedAt: string | null;
};

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 8000;

function formatDateTime(value: string | null): string {
    if (!value) return '-';
    return toDisplayDateTime(new Date(value)).replace(',', '');
}

function formatDateOnly(value: string | null): string {
    if (!value) return '';
    return toDisplayDate(new Date(value));
}

function StatusBadge({ row }: { row: ReportRequestRow }) {
    switch (row.status) {
        case 'PENDING':
            return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300">Pending</Badge>;
        case 'PROCESSING':
            return (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    {row.progressPercent}%
                </Badge>
            );
        case 'COMPLETED':
            return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400">100% Completed</Badge>;
        case 'FAILED':
            return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400" title={row.errorMessage ?? undefined}>Failed</Badge>;
        case 'CANCELLED':
            return <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400">Cancelled</Badge>;
        default:
            return <Badge variant="outline">-</Badge>;
    }
}

export function RequestReportClient() {
    const { toast } = useToast();
    const [fromDate, setFromDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [rows, setRows] = useState<ReportRequestRow[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const buildEndpoint = useCallback(
        (pageArg: number) => `/report-requests?page=${pageArg}&pageSize=${PAGE_SIZE}&fromDate=${fromDate}&toDate=${toDate}`,
        [fromDate, toDate]
    );

    const fetchPage = useCallback(async (pageArg: number, silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const result = await apiClient.get<{ data: ReportRequestRow[]; totalCount: number; totalPages: number; page: number }>(
                buildEndpoint(pageArg)
            );
            if (result.success && result.data) {
                setRows(result.data.data);
                setTotalCount(result.data.totalCount);
                setTotalPages(result.data.totalPages || 1);
                setPage(result.data.page ?? pageArg);
            } else if (!silent) {
                toast({ title: 'Error', description: result.error || 'Failed to load report requests.', variant: 'destructive' });
            }
        } catch {
            if (!silent) toast({ title: 'Error', description: 'Failed to communicate with the server.', variant: 'destructive' });
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [buildEndpoint, toast]);

    useEffect(() => {
        fetchPage(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate]);

    // Poll quietly while any visible row is still in flight, so status/progress
    // updates without the user needing to hit Refresh.
    useEffect(() => {
        const hasActive = rows.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (hasActive) {
            pollRef.current = setInterval(() => fetchPage(page, true), POLL_INTERVAL_MS);
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, page]);

    const handleDownload = async (row: ReportRequestRow) => {
        if (!row.storageKey) return;
        const ext = row.fileFormat.toLowerCase();
        const ok = await downloadStorageFile(row.storageKey, `${row.reportName}_${row.requestId}.${ext}`);
        if (!ok) toast({ title: 'Download unavailable', description: 'The export file could not be retrieved.', variant: 'destructive' });
    };

    const handleRetry = async (row: ReportRequestRow) => {
        setRetryingId(row.id);
        try {
            const result = await apiClient.post(`/report-requests/${row.id}/retry`);
            if (result.success) {
                toast({ title: 'Queued again', description: `Request ${row.requestId} will be generated again with the same conditions.` });
                fetchPage(page, true);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to retry request.', variant: 'destructive' });
            }
        } finally {
            setRetryingId(null);
        }
    };

    const handleCancel = async (row: ReportRequestRow) => {
        setCancellingId(row.id);
        try {
            const result = await apiClient.post(`/report-requests/${row.id}/cancel`);
            if (result.success) {
                toast({ title: 'Cancelled', description: `Request ${row.requestId} has been cancelled.` });
                fetchPage(page, true);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to cancel request.', variant: 'destructive' });
            }
        } finally {
            setCancellingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-sidebar-accent">
                    <CardTitle className="text-lg text-white">Request Report</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">From Date</Label>
                            <div className="relative">
                                <DateInput id="fromDate" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11 pl-10" disabled={isLoading} />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">To Date</Label>
                            <div className="relative">
                                <DateInput id="toDate" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-11 pl-10" disabled={isLoading} />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-2 md:col-span-2 flex items-end">
                            <Button onClick={() => fetchPage(1)} disabled={isLoading} className="h-11 bg-primary text-white hover:bg-sidebar-accent">
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Refresh
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                <CardHeader className="bg-green-50/50 dark:bg-brand-green-darker/50 border-b border-slate-100 dark:border-sidebar-accent">
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-lg">Request Report #: {totalCount}</CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {rows.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-green-50 dark:bg-sidebar-accent/50">
                                    <TableRow>
                                        <TableHead className="w-[50px]">S.No</TableHead>
                                        <TableHead>Request ID</TableHead>
                                        <TableHead>Branch</TableHead>
                                        <TableHead>Requested By</TableHead>
                                        <TableHead>Requested Report</TableHead>
                                        <TableHead>Date Conditions</TableHead>
                                        <TableHead>Requested On</TableHead>
                                        <TableHead>Completed On</TableHead>
                                        <TableHead className="text-right">Total Count</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Download Link</TableHead>
                                        <TableHead>Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row, index) => (
                                        <TableRow key={row.id} className="hover:bg-green-50/80 dark:hover:bg-sidebar-accent/80">
                                            <TableCell className="font-medium">{(page - 1) * PAGE_SIZE + index + 1}</TableCell>
                                            <TableCell className="font-mono text-xs">{row.requestId}</TableCell>
                                            <TableCell className="max-w-[220px] truncate" title={row.branchLabel}>{row.branchLabel}</TableCell>
                                            <TableCell className="whitespace-nowrap">{row.requestedByName}</TableCell>
                                            <TableCell>{row.reportName}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs">
                                                {row.fromDate && row.toDate ? `${formatDateOnly(row.fromDate)} to ${formatDateOnly(row.toDate)}` : '-'}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-xs">{formatDateTime(row.requestedAt)}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs">{formatDateTime(row.completedAt)}</TableCell>
                                            <TableCell className="text-right">{row.totalCount}</TableCell>
                                            <TableCell><StatusBadge row={row} /></TableCell>
                                            <TableCell>
                                                {row.status === 'COMPLETED' && row.storageKey ? (
                                                    <Button variant="outline" size="sm" onClick={() => handleDownload(row)}>
                                                        <Download className="w-3.5 h-3.5 mr-1" />
                                                        Download
                                                    </Button>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {(row.status === 'PENDING' || row.status === 'PROCESSING') ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleCancel(row)}
                                                        disabled={cancellingId === row.id}
                                                        className="text-rose-600 border-rose-200 hover:text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
                                                    >
                                                        {cancellingId === row.id ? (
                                                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                                        ) : (
                                                            <XCircle className="w-3.5 h-3.5 mr-1" />
                                                        )}
                                                        Cancel
                                                    </Button>
                                                ) : (row.status === 'FAILED' || row.status === 'CANCELLED') ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleRetry(row)}
                                                        disabled={retryingId === row.id}
                                                        title={row.errorMessage ?? undefined}
                                                        className="text-emerald-700 border-emerald-200 hover:text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                                                    >
                                                        {retryingId === row.id ? (
                                                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                                        ) : (
                                                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                                        )}
                                                        Retry
                                                    </Button>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="p-12 text-center">
                            <FileText className="mx-auto h-16 w-16 text-slate-300 dark:text-sidebar-accent mb-4" />
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                No report requests found for the selected date range.
                            </p>
                        </div>
                    )}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                            </p>
                            <div className="flex gap-1">
                                <Button variant="outline" size="sm" onClick={() => fetchPage(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                                    Previous
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => fetchPage(Math.min(totalPages, page + 1))} disabled={page === totalPages || isLoading}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
