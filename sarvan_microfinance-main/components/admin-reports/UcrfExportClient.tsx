'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    FileJson,
    FileSpreadsheet,
    FileText,
    FileWarning,
    Loader2,
    RotateCcw,
    Search,
    Settings2,
    XCircle,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ExportFormat = 'cdf' | 'csv' | 'xlsx' | 'json' | 'errors';

interface Filters {
    reportDate: string;
    branchId: string;
    loanProductId: string;
    loanStatus: 'ALL' | 'ACTIVE' | 'CLOSED';
    search: string;
    validity: 'ALL' | 'VALID' | 'INVALID';
}

interface Issue {
    fieldNo: number;
    field: string;
    value: string;
    reason: string;
    suggestion?: string;
    severity: 'error' | 'warning';
}

interface Row {
    loanId: string;
    loanNumber: string;
    memberId: string;
    memberName: string;
    branchName: string;
    centerName: string;
    groupIdentifier: string | null;
    disbursementDate: string | null;
    disbursedAmount: number;
    outstandingBalance: number;
    overdueAmount: number;
    dpd: number;
    accountStatus: string;
    isValid: boolean;
    issues: Issue[];
}

interface PageData {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    rows: Row[];
}

interface Summary {
    totalMembers: number;
    totalRecords: number;
    validRecords: number;
    invalidRecords: number;
    warningRecords: number;
}

interface SummaryData {
    configSaved: boolean;
    fileLevelErrors: string[];
    summary: Summary;
    lastExport: { at: string; format: string | null; reportDate: string | null; included: number | null } | null;
}

interface Config {
    memberId: string;
    institutionName: string;
    submittingBranchId: string;
    fileFrequency: string;
    oldMemberId: string;
    loanCategory: string;
}

interface JobStatus {
    state: 'none' | 'running' | 'done' | 'error';
    done: number;
    total: number;
    error?: string;
}

interface Options {
    branches: Array<{ id: string; code: string; name: string }>;
    products: Array<{ id: string; productName: string }>;
}

const ALL = '__all__';
const EMPTY_CONFIG: Config = { memberId: '', institutionName: '', submittingBranchId: '', fileFrequency: 'ME', oldMemberId: '', loanCategory: 'T02' };

const FORMATS: Array<{ id: ExportFormat; label: string; icon: React.ElementType; hint: string }> = [
    { id: 'cdf', label: 'UCRF / CDF', icon: FileText, hint: 'Official submission file — valid records only' },
    { id: 'csv', label: 'CSV', icon: FileText, hint: 'Same 100 UCRF fields & records as the CDF' },
    { id: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet, hint: 'Same data as the CDF + validation sheet' },
    { id: 'json', label: 'JSON', icon: FileJson, hint: 'Same data as the CDF + report metadata' },
];

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const defaultFilters = (): Filters => ({ reportDate: todayIst(), branchId: ALL, loanProductId: ALL, loanStatus: 'ALL', search: '', validity: 'ALL' });
const fmtInt = (n: number) => n.toLocaleString('en-IN');
const fmtDate = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}` : '—');

function toRequestFilters(f: Filters) {
    return {
        reportDate: f.reportDate,
        ...(f.branchId !== ALL ? { branchId: f.branchId } : {}),
        ...(f.loanProductId !== ALL ? { loanProductId: f.loanProductId } : {}),
        loanStatus: f.loanStatus,
        ...(f.search.trim() ? { search: f.search.trim() } : {}),
        validity: f.validity,
    };
}

function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function UcrfExportClient() {
    const { toast } = useToast();

    const [draft, setDraft] = useState<Filters>(defaultFilters);
    const [applied, setApplied] = useState<Filters | null>(null); // null until the first Apply Filters click
    const [options, setOptions] = useState<Options>({ branches: [], products: [] });

    const [summary, setSummary] = useState<SummaryData | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const [pageData, setPageData] = useState<PageData | null>(null);
    const [pageLoading, setPageLoading] = useState(false);
    const [pageError, setPageError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [sortBy, setSortBy] = useState('loanNumber');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    const [selected, setSelected] = useState<Row | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const [config, setConfig] = useState<Config>(EMPTY_CONFIG);
    const [configSaving, setConfigSaving] = useState(false);

    const [confirmFormat, setConfirmFormat] = useState<ExportFormat | null>(null);
    const [exporting, setExporting] = useState<ExportFormat | null>(null);
    const exportLock = useRef(false);
    const [exportProgress, setExportProgress] = useState<number | null>(null); // null = not exporting, -1 = size unknown
    const reqId = useRef(0);

    // Apply flow: a throttled server-side job calculates the dataset (polled for real progress), then the summary
    // and preview just read its result.
    const [applying, setApplying] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [progressNote, setProgressNote] = useState('');
    const pendingApply = useRef(0);
    const applyRun = useRef(0);

    // ── Data loading ────────────────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            const [opts, cfg] = await Promise.all([
                apiClient.get<Options>('/ucrf-export/options'),
                apiClient.get<{ config: Config | null }>('/ucrf-export/config'),
            ]);
            if (opts.success && opts.data) setOptions(opts.data);
            if (cfg.success && cfg.data?.config) setConfig({ ...EMPTY_CONFIG, ...cfg.data.config });
        })();
    }, []);

    const settleApply = () => {
        if (pendingApply.current > 0 && --pendingApply.current === 0) setApplying(false);
    };

    const loadSummary = useCallback(async (f: Filters) => {
        setSummaryLoading(true);
        setSummaryError(null);
        const res = await apiClient.post<SummaryData>('/ucrf-export/summary', { filters: toRequestFilters(f) });
        if (res.success && res.data) setSummary(res.data);
        else {
            setSummary(null);
            setSummaryError(res.error || 'Could not calculate the summary');
        }
        setSummaryLoading(false);
        settleApply();
    }, []);

    const loadPage = useCallback(async (f: Filters, p: number, sb: string, sd: 'asc' | 'desc') => {
        const id = ++reqId.current;
        setPageLoading(true);
        setPageError(null);
        const res = await apiClient.post<PageData>('/ucrf-export/preview', {
            filters: toRequestFilters(f),
            page: { page: p, pageSize: 25, sortBy: sb, sortDir: sd },
        });
        if (id !== reqId.current) return; // a newer request superseded this one
        if (res.success && res.data) setPageData(res.data);
        else {
            setPageData(null);
            setPageError(res.error || 'Could not load the preview');
        }
        setPageLoading(false);
        settleApply();
    }, []);

    useEffect(() => {
        if (applied) loadSummary(applied);
    }, [applied, loadSummary]);

    useEffect(() => {
        if (applied) loadPage(applied, page, sortBy, sortDir);
    }, [applied, page, sortBy, sortDir, loadPage]);

    // Cancel any in-flight polling when the page unmounts.
    useEffect(() => () => { applyRun.current = -1; }, []);

    useEffect(() => {
        if (applying) return;
        setProgress((p) => (p === null ? null : 100));
        const t = setTimeout(() => setProgress(null), 900);
        return () => clearTimeout(t);
    }, [applying]);

    const startApply = async (f: Filters) => {
        const run = ++applyRun.current;
        const filters = toRequestFilters(f);
        const fail = (message: string) => {
            toast({ title: 'Could not load the report', description: message, variant: 'destructive' });
            setProgress(null);
            setApplying(false);
        };
        setApplying(true);
        setProgress(0);
        setProgressNote('Starting…');

        let res = await apiClient.post<JobStatus>('/ucrf-export/job', { action: 'start', filters });
        let failures = 0;
        for (;;) {
            if (run !== applyRun.current) return; // superseded, or the page was closed
            if (!res.success || !res.data) {
                if (res.error && /already running|expired|valid|future/i.test(res.error)) return fail(res.error);
                if (++failures > 3) return fail(res.error || 'The server could not be reached.');
            } else {
                failures = 0;
                const st = res.data;
                if (st.state === 'error') return fail(st.error || 'The calculation failed.');
                if (st.state === 'none') return fail('The calculation was interrupted. Click Apply Filters again.');
                if (st.state === 'done') break;
                setProgress(st.total > 0 ? Math.min(99, (st.done / st.total) * 100) : 1);
                setProgressNote(st.total > 0 ? `${fmtInt(st.done)} of ${fmtInt(st.total)} loans` : 'Finding eligible loans…');
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (run !== applyRun.current) return;
            res = await apiClient.post<JobStatus>('/ucrf-export/job', { action: 'status', filters });
        }

        setProgress(100);
        setProgressNote('Preparing the preview…');
        pendingApply.current = 2; // summary + preview, both read the finished result
        setPage(1);
        setApplied({ ...f });
    };

    const applyFilters = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.reportDate)) {
            toast({ title: 'Report date required', description: 'Choose the reporting date.', variant: 'destructive' });
            return;
        }
        if (draft.reportDate > todayIst()) {
            toast({ title: 'Invalid date', description: 'The reporting date cannot be in the future.', variant: 'destructive' });
            return;
        }
        startApply(draft);
    };

    const resetFilters = () => {
        const f = defaultFilters();
        setDraft(f);
        startApply(f);
    };

    const toggleSort = (key: string) => {
        if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSortBy(key);
            setSortDir('asc');
        }
        setPage(1);
    };

    // ── Config ──────────────────────────────────────────────────────────────────────
    const saveConfig = async () => {
        setConfigSaving(true);
        const res = await apiClient.put<{ config: Config }>('/ucrf-export/config', config);
        setConfigSaving(false);
        if (res.success) {
            toast({ title: 'Settings saved', description: 'Institution identifiers saved for UCRF files.' });
            setConfigOpen(false);
            if (applied) loadSummary(applied);
        } else {
            toast({ title: 'Could not save settings', description: res.error || 'Please check the values.', variant: 'destructive' });
        }
    };

    // ── Export ──────────────────────────────────────────────────────────────────────
    const runExport = async (format: ExportFormat) => {
        if (exportLock.current || !applied) return; // prevent duplicate requests
        exportLock.current = true;
        setExporting(format);
        // CDF/CSV are one line per record, so counting line breaks against the record count gives true progress.
        // Excel/JSON/error report have no such count, so they show a moving bar until the file arrives.
        const lineBased = format === 'cdf' || format === 'csv';
        let lines = 0;
        setExportProgress(lineBased ? 0 : -1);
        try {
            const res = await apiClient.postForFile('/ucrf-export/export', { format, filters: toRequestFilters(applied) }, lineBased
                ? (chunk, headers) => {
                      for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) lines++;
                      const expected = Number(headers.get('X-Ucrf-Included') ?? 0) + (format === 'cdf' ? 2 : 1); // + header/trailer lines
                      if (expected > 0) setExportProgress(Math.min(99, (lines / expected) * 100));
                  }
                : undefined);
            if (!res.success) {
                toast({ title: 'Export failed', description: res.error, variant: 'destructive' });
                return;
            }
            saveBlob(res.blob, res.filename || `ucrf-export.${format === 'cdf' ? 'cdf' : format === 'errors' ? 'csv' : format}`);
            const included = res.headers.get('X-Ucrf-Included');
            const excluded = res.headers.get('X-Ucrf-Excluded');
            toast({
                title: 'File generated',
                description: `${included ?? '?'} record(s) included${excluded && excluded !== '0' ? `, ${excluded} invalid record(s) excluded` : ''}. Generation does not mean a credit bureau has accepted the file.`,
            });
            setConfirmFormat(null);
            loadSummary(applied);
        } finally {
            exportLock.current = false;
            setExporting(null);
            setExportProgress(null);
        }
    };

    const s = summary?.summary;
    const cdfBlocked = !summary?.configSaved || (summary?.fileLevelErrors?.length ?? 0) > 0;
    const hasInvalid = (s?.invalidRecords ?? 0) > 0;
    const appliedBranch = options.branches.find((b) => b.id === applied?.branchId)?.name;
    const appliedProduct = options.products.find((p) => p.id === applied?.loanProductId)?.productName;

    const confirmCounts = useMemo(() => {
        if (!s || !confirmFormat) return null;
        const scopedTotal = pageData?.total ?? s.totalRecords;
        const included = confirmFormat === 'errors' ? hasInvalidOrWarn(s) : s.validRecords;
        return { scopedTotal, included };
    }, [s, confirmFormat, pageData]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-2">
                <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
                    <span>/</span>
                    <span>Admin Reports</span>
                    <span>/</span>
                    <span>Others</span>
                    <span>/</span>
                    <span className="text-foreground">UCRF Export</span>
                </nav>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">UCRF / CDF Export</h1>
                        <p className="text-sm text-muted-foreground">Generate and validate credit bureau submission files</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
                        <Settings2 className="mr-2 h-4 w-4" />
                        Institution settings
                    </Button>
                </div>
            </div>

            {summary && !summary.configSaved && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="flex-1">
                        <p className="font-medium">Institution settings are not saved</p>
                        <p>The CDF header and trailer need your CIC Member ID and institution name. Save them before exporting.</p>
                    </div>
                    <Button size="sm" onClick={() => setConfigOpen(true)}>Set up now</Button>
                </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard title="Eligible members" value={s?.totalMembers} loading={summaryLoading} error={summaryError} />
                <StatCard title="Eligible loan records" value={s?.totalRecords} loading={summaryLoading} error={summaryError} />
                <StatCard title="Valid records" value={s?.validRecords} loading={summaryLoading} error={summaryError} tone="good" />
                <StatCard title="With validation errors" value={s?.invalidRecords} loading={summaryLoading} error={summaryError} tone={hasInvalid ? 'bad' : undefined} />
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Last successful export</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {summaryLoading ? (
                            <Skeleton className="h-6 w-32" />
                        ) : summary?.lastExport ? (
                            <div className="text-sm">
                                <p className="font-semibold">{new Date(summary.lastExport.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(summary.lastExport.format ?? '').toUpperCase()} · {summary.lastExport.reportDate ? fmtDate(summary.lastExport.reportDate) : ''}
                                </p>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">{summaryError ? 'Unavailable' : 'No export yet'}</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Report filters</CardTitle>
                    <CardDescription>Applied to the cards, preview, validation and every export format.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        <div className="space-y-1.5">
                            <Label htmlFor="ucrf-date">Reporting date</Label>
                            <Input id="ucrf-date" type="date" max={todayIst()} value={draft.reportDate} onChange={(e) => setDraft({ ...draft, reportDate: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Branch</Label>
                            <Select value={draft.branchId} onValueChange={(v) => setDraft({ ...draft, branchId: v })}>
                                <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL}>All branches</SelectItem>
                                    {options.branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Loan product</Label>
                            <Select value={draft.loanProductId} onValueChange={(v) => setDraft({ ...draft, loanProductId: v })}>
                                <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL}>All products</SelectItem>
                                    {options.products.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Loan status</Label>
                            <Select value={draft.loanStatus} onValueChange={(v) => setDraft({ ...draft, loanStatus: v as Filters['loanStatus'] })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Active + closed this month</SelectItem>
                                    <SelectItem value="ACTIVE">Active only</SelectItem>
                                    <SelectItem value="CLOSED">Closed this month</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Validation</Label>
                            <Select value={draft.validity} onValueChange={(v) => setDraft({ ...draft, validity: v as Filters['validity'] })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All</SelectItem>
                                    <SelectItem value="VALID">Valid</SelectItem>
                                    <SelectItem value="INVALID">Invalid</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ucrf-search">Member / loan</Label>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="ucrf-search"
                                    className="pl-8"
                                    placeholder="Name, member ID, loan no."
                                    value={draft.search}
                                    onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                                    onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Button onClick={applyFilters} disabled={applying || summaryLoading || pageLoading}>
                            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {applying ? 'Processing…' : 'Apply Filters'}
                        </Button>
                        <Button variant="outline" onClick={resetFilters} disabled={applying}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Reset
                        </Button>
                    </div>
                    {progress !== null && (
                        <div className="mt-4 space-y-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{progress >= 100 && !applying ? 'Processing complete' : `Processing data… ${progressNote}`}</span>
                                <span className="font-medium tabular-nums text-foreground">{Math.round(progress)}%</span>
                            </div>
                            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className={cn('relative h-full overflow-hidden rounded-full transition-all duration-300 ease-out', progress >= 100 ? 'bg-green-600' : 'bg-primary')}
                                    style={{ width: `${progress}%` }}
                                >
                                    {progress < 100 && <div className="absolute inset-0 animate-pulse bg-white/30" />}
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Export actions */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Export</CardTitle>
                    <CardDescription>
                        CDF, CSV, Excel and JSON all contain the same 100 UCRF fields for the same records: valid records only. Invalid records are listed in the validation-error report (and the Excel Validation Errors sheet).
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {summary && summary.fileLevelErrors.length > 0 && summary.configSaved && (
                        <p className="text-sm text-destructive">CDF blocked: {summary.fileLevelErrors.join('; ')}</p>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {FORMATS.map(({ id, label, icon: Icon, hint }) => (
                            <Button
                                key={id}
                                variant={id === 'cdf' ? 'default' : 'outline'}
                                className="h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left"
                                disabled={exporting !== null || summaryLoading || !summary || (id === 'cdf' && cdfBlocked) || !summary?.configSaved}
                                onClick={() => setConfirmFormat(id)}
                            >
                                <span className="flex items-center gap-2 font-semibold">
                                    {exporting === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                                    {label}
                                </span>
                                <span className="text-xs font-normal opacity-80">{hint}</span>
                            </Button>
                        ))}
                    </div>
                    <ExportProgress value={exportProgress} />
                    {hasInvalid && (
                        <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => runExport('errors')}>
                            {exporting === 'errors' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileWarning className="mr-2 h-4 w-4" />}
                            Download validation-error report
                        </Button>
                    )}
                </CardContent>
            </Card>

            {/* Preview */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Preview</CardTitle>
                    <CardDescription>
                        {pageData ? `${fmtInt(pageData.total)} record(s)` : 'Records that will be exported'} — click a row to inspect validation details.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {pageError ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <XCircle className="h-8 w-8 text-destructive" />
                            <p className="text-sm">{pageError}</p>
                            <Button variant="outline" size="sm" onClick={() => applied && loadPage(applied, page, sortBy, sortDir)}>Try again</Button>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <SortHead label="Member ID" k="memberId" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Member" k="memberName" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Branch" k="branchName" {...{ sortBy, sortDir, toggleSort }} />
                                            <TableHead>Center / Group</TableHead>
                                            <SortHead label="Loan no." k="loanNumber" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Disbursed on" k="disbursementDate" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Disbursed (₹)" k="disbursedAmount" align="right" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Outstanding (₹)" k="outstandingBalance" align="right" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Overdue (₹)" k="overdueAmount" align="right" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="DPD" k="dpd" align="right" {...{ sortBy, sortDir, toggleSort }} />
                                            <SortHead label="Status" k="status" {...{ sortBy, sortDir, toggleSort }} />
                                            <TableHead>Errors</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {pageLoading &&
                                            Array.from({ length: 8 }, (_, i) => (
                                                <TableRow key={`sk-${i}`}>
                                                    {Array.from({ length: 12 }, (_, j) => (
                                                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        {!applied && !pageLoading && (
                                            <TableRow>
                                                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                                                    Choose your filters and click “Apply Filters” to load the records.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {!pageLoading && pageData?.rows.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                                                    No eligible records for these filters.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {!pageLoading &&
                                            pageData?.rows.map((r) => {
                                                const errors = r.issues.filter((i) => i.severity === 'error');
                                                const warnings = r.issues.length - errors.length;
                                                return (
                                                    <TableRow key={r.loanId} className="cursor-pointer" onClick={() => setSelected(r)}>
                                                        <TableCell className="font-mono text-xs">{r.memberId}</TableCell>
                                                        <TableCell>{r.memberName}</TableCell>
                                                        <TableCell>{r.branchName}</TableCell>
                                                        <TableCell className="text-xs">{r.centerName}{r.groupIdentifier ? ` / ${r.groupIdentifier}` : ''}</TableCell>
                                                        <TableCell className="font-mono text-xs">{r.loanNumber}</TableCell>
                                                        <TableCell>{fmtDate(r.disbursementDate)}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{fmtInt(r.disbursedAmount)}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{fmtInt(r.outstandingBalance)}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{fmtInt(r.overdueAmount)}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{r.dpd}</TableCell>
                                                        <TableCell>
                                                            {r.isValid ? (
                                                                <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" />Valid</Badge>
                                                            ) : (
                                                                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Invalid</Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={errors.map((e) => e.reason).join('; ')}>
                                                            {errors[0]?.reason ?? (warnings ? `${warnings} warning(s)` : '—')}
                                                            {errors.length > 1 ? ` (+${errors.length - 1})` : ''}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                    </TableBody>
                                </Table>
                            </div>
                            {pageData && pageData.total > 0 && (
                                <div className="mt-3 flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        Page {pageData.page} of {pageData.totalPages}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" disabled={page <= 1 || pageLoading} onClick={() => setPage((p) => p - 1)}>
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button variant="outline" size="sm" disabled={page >= pageData.totalPages || pageLoading} onClick={() => setPage((p) => p + 1)}>
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Record detail */}
            <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                    {selected && (
                        <>
                            <SheetHeader>
                                <SheetTitle>{selected.memberName}</SheetTitle>
                                <SheetDescription>
                                    Member {selected.memberId} · Loan {selected.loanNumber} · {selected.isValid ? 'Valid' : 'Invalid'}
                                </SheetDescription>
                            </SheetHeader>
                            <div className="space-y-3 px-4 pb-6">
                                {selected.issues.length === 0 && <p className="text-sm text-muted-foreground">No validation issues.</p>}
                                {selected.issues.map((i, idx) => (
                                    <div key={`${i.fieldNo}-${idx}`} className={cn('rounded-md border p-3 text-sm', i.severity === 'error' ? 'border-destructive/50 bg-destructive/5' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30')}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium">{i.field}{i.fieldNo ? ` (#${i.fieldNo})` : ''}</span>
                                            <Badge variant={i.severity === 'error' ? 'destructive' : 'secondary'}>{i.severity}</Badge>
                                        </div>
                                        <p className="mt-1">{i.reason}</p>
                                        {i.value && <p className="mt-1 font-mono text-xs text-muted-foreground">Value: {i.value}</p>}
                                        {i.suggestion && <p className="mt-1 text-xs">Suggestion: {i.suggestion}</p>}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>

            {/* Confirmation */}
            <Dialog open={confirmFormat !== null} onOpenChange={(o) => !o && exporting === null && setConfirmFormat(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirm export — {FORMATS.find((f) => f.id === confirmFormat)?.label}</DialogTitle>
                        <DialogDescription>Review what will be generated.</DialogDescription>
                    </DialogHeader>
                    {s && confirmCounts && (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <dt className="text-muted-foreground">Reporting date</dt>
                            <dd>{fmtDate(applied?.reportDate ?? null)}</dd>
                            <dt className="text-muted-foreground">Branch</dt>
                            <dd>{appliedBranch ?? 'All branches'}</dd>
                            <dt className="text-muted-foreground">Product</dt>
                            <dd>{appliedProduct ?? 'All products'}</dd>
                            <dt className="text-muted-foreground">Loan status</dt>
                            <dd>{applied?.loanStatus === 'ALL' ? 'Active + closed this month' : applied?.loanStatus === 'ACTIVE' ? 'Active only' : 'Closed this month'}</dd>
                            <dt className="text-muted-foreground">Total eligible records</dt>
                            <dd>{fmtInt(s.totalRecords)}</dd>
                            <dt className="text-muted-foreground">Valid records</dt>
                            <dd>{fmtInt(s.validRecords)}</dd>
                            <dt className="text-muted-foreground">Invalid records</dt>
                            <dd className={hasInvalid ? 'font-medium text-destructive' : ''}>{fmtInt(s.invalidRecords)}</dd>
                            <dt className="font-medium">Records in this file</dt>
                            <dd className="font-medium">{fmtInt(confirmCounts.included)}</dd>
                        </dl>
                    )}
                    {confirmFormat !== 'errors' && hasInvalid && (
                        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            {fmtInt(s?.invalidRecords ?? 0)} invalid record(s) will be <strong>excluded</strong> from this file. Download the validation-error report or fix the member/loan data first if they must be reported.
                        </p>
                    )}
                    <ExportProgress value={exportProgress} />
                    <p className="text-xs text-muted-foreground">Generating a file does not submit it to, or imply acceptance by, any credit bureau.</p>
                    <DialogFooter>
                        <Button variant="outline" disabled={exporting !== null} onClick={() => setConfirmFormat(null)}>Cancel</Button>
                        <Button disabled={exporting !== null || !confirmFormat} onClick={() => confirmFormat && runExport(confirmFormat)}>
                            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            {exporting ? 'Generating…' : 'Generate & download'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Institution settings */}
            <Dialog open={configOpen} onOpenChange={setConfigOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Institution settings</DialogTitle>
                        <DialogDescription>Identifiers written into the CDF header and trailer. Use the values issued to your institution by the credit information company.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <ConfigField id="memberId" label="Member ID (max 10, e.g. NBF…)" value={config.memberId} max={10} onChange={(v) => setConfig({ ...config, memberId: v })} />
                        <ConfigField id="institutionName" label="Institution name (max 30)" value={config.institutionName} max={30} onChange={(v) => setConfig({ ...config, institutionName: v })} />
                        <ConfigField id="submittingBranchId" label="Submitting branch ID (optional, max 30)" value={config.submittingBranchId} max={30} onChange={(v) => setConfig({ ...config, submittingBranchId: v })} />
                        <ConfigField id="oldMemberId" label="Old member ID (migrated files only, max 30)" value={config.oldMemberId} max={30} onChange={(v) => setConfig({ ...config, oldMemberId: v })} />
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>File frequency</Label>
                                <Select value={config.fileFrequency} onValueChange={(v) => setConfig({ ...config, fileFrequency: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {[['ME', 'Month end'], ['DL', 'Daily'], ['W1', 'Weekly 1 (9th)'], ['W2', 'Weekly 2 (16th)'], ['W3', 'Weekly 3 (23rd)'], ['DC', 'Data correction'], ['AH', 'Ad hoc'], ['RR', 'Rejection resubmission']].map(([v, l]) => (
                                            <SelectItem key={v} value={v}>{v} — {l}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Loan category</Label>
                                <Select value={config.loanCategory} onValueChange={(v) => setConfig({ ...config, loanCategory: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="T01">T01 — JLG Group</SelectItem>
                                        <SelectItem value="T02">T02 — JLG Individual</SelectItem>
                                        <SelectItem value="T03">T03 — Individual</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfigOpen(false)} disabled={configSaving}>Cancel</Button>
                        <Button onClick={saveConfig} disabled={configSaving || !config.memberId.trim() || !config.institutionName.trim()}>
                            {configSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save settings
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** value: null = hidden, -1 = size unknown (moving bar), 0–99 = real progress of the file download. */
function ExportProgress({ value }: { value: number | null }) {
    if (value === null) return null;
    const known = value >= 0;
    return (
        <div className="space-y-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(value) : undefined}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Generating file… please keep this page open</span>
                {known && <span className="font-medium tabular-nums text-foreground">{Math.round(value)}%</span>}
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {known ? (
                    <div className="h-full rounded-full bg-primary transition-all duration-300 ease-out" style={{ width: `${value}%` }} />
                ) : (
                    <div className="absolute inset-y-0 w-1/3 animate-[ucrf-slide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
                )}
            </div>
            <style>{'@keyframes ucrf-slide{0%{left:-35%}100%{left:100%}}'}</style>
        </div>
    );
}

function hasInvalidOrWarn(s: Summary) {
    return s.invalidRecords + s.warningRecords;
}

function StatCard({ title, value, loading, error, tone }: { title: string; value: number | undefined; loading: boolean; error: string | null; tone?: 'good' | 'bad' }) {
    return (
        <Card>
            <CardHeader className="pb-2"><CardDescription>{title}</CardDescription></CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-8 w-20" />
                ) : value === undefined ? (
                    <p className="text-sm text-muted-foreground" title={error ?? undefined}>{error ? 'Unavailable' : '—'}</p>
                ) : (
                    <p className={cn('text-2xl font-bold tabular-nums', tone === 'good' && 'text-green-600', tone === 'bad' && 'text-destructive')}>{fmtInt(value)}</p>
                )}
            </CardContent>
        </Card>
    );
}

function SortHead({ label, k, sortBy, sortDir, toggleSort, align }: { label: string; k: string; sortBy: string; sortDir: 'asc' | 'desc'; toggleSort: (k: string) => void; align?: 'right' }) {
    const Icon = sortBy !== k ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
        <TableHead className={cn('whitespace-nowrap', align === 'right' && 'text-right')}>
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
                {label}
                <Icon className="h-3 w-3 opacity-60" />
            </button>
        </TableHead>
    );
}

function ConfigField({ id, label, value, max, onChange }: { id: string; label: string; value: string; max: number; onChange: (v: string) => void }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
        </div>
    );
}
