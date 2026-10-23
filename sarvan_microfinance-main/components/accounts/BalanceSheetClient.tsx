'use client';

import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { AlertCircle, Calendar, CheckCircle2, ChevronDown, Filter, Loader2, Printer, RefreshCw, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import {
    balanceSheetFilenameBase,
    balanceSheetModeLabel,
    buildBalanceSheetLines,
    type BalanceSheetMode,
    type BalanceSheetReport,
    type BsLine,
} from '@/app/lib/reports/balance-sheet';
import { downloadBalanceSheetExcel, drawBalanceSheetReport } from '@/app/lib/reports/balance-sheet-export';
import { formatInr } from '@/app/lib/reports/profit-loss-export';

interface Branch {
    id: string;
    code: string;
    name: string;
}

const todayYmd = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const formatDmy = (ymd: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
};

function BsColumn({ lines, title }: { lines: BsLine[]; title: string }) {
    return (
        <div className="min-w-0">
            <div className="grid grid-cols-[1fr_6rem_7.5rem] gap-2 border-b border-black bg-slate-100 px-2 py-1.5 text-xs font-bold uppercase">
                <span>{title}</span>
                <span className="text-center">Code</span>
                <span className="text-right">Amount</span>
            </div>
            {lines.map((line, i) => (
                <div
                    key={i}
                    style={{ paddingLeft: `${0.5 + line.depth * 1}rem` }}
                    className={cn(
                        'grid grid-cols-[1fr_6rem_7.5rem] gap-2 py-1 pr-2 text-[13px]',
                        line.style === 'ledger' && 'border-b border-slate-100 hover:bg-green-50/60',
                        line.style === 'group' && 'bg-slate-50 font-bold',
                        line.style === 'subtotal' && 'font-semibold italic',
                        (line.style === 'net' || line.style === 'total') && 'border-y border-black bg-slate-100 font-bold',
                        line.style === 'blank' && 'min-h-[1.5rem]',
                    )}
                >
                    <span className="break-words">{line.label}</span>
                    <span className="break-all text-center text-xs text-slate-600">{line.code}</span>
                    <span className={cn('text-right tabular-nums', line.amount !== null && line.amount < 0 && 'text-red-600')}>
                        {line.amount === null ? '' : formatInr(line.amount)}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function BalanceSheetClient() {
    const { toast } = useToast();
    const { canExportReport } = usePermission();
    const branchRef = useRef<HTMLDivElement>(null);
    const printRef = useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: 'BalanceSheet' });

    const [branches, setBranches] = useState<Branch[]>([]);
    const [allowAll, setAllowAll] = useState(false);
    const [isFetchingBranches, setIsFetchingBranches] = useState(true);
    const [branchId, setBranchId] = useState('all');
    const [branchSearch, setBranchSearch] = useState('');
    const [branchOpen, setBranchOpen] = useState(false);

    const [asOnDate, setAsOnDate] = useState(todayYmd());
    const [mode, setMode] = useState<BalanceSheetMode>('GROUP');

    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [report, setReport] = useState<BalanceSheetReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await apiClient.get<{ branches: Branch[]; allowAll: boolean }>('/reports/balance-sheet/branches');
                if (!res.success || !res.data) throw new Error(res.message || 'Could not fetch branch list.');
                setBranches(res.data.branches);
                setAllowAll(res.data.allowAll);
                setBranchId(res.data.allowAll ? 'all' : res.data.branches[0]?.id ?? 'all');
            } catch (e) {
                toast({ title: 'Error', description: e instanceof Error ? e.message : 'Could not fetch branch list.', variant: 'destructive' });
            } finally {
                setIsFetchingBranches(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (branchRef.current && !branchRef.current.contains(e.target as Node)) setBranchOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const selectedBranch = branches.find((b) => b.id === branchId) ?? null;
    const branchLabel = branchId === 'all' ? 'All Branches' : selectedBranch ? `${selectedBranch.code} - ${selectedBranch.name}` : '';
    const q = branchSearch.trim().toLowerCase();
    const filteredBranches = branches.filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));

    const handleGenerate = async () => {
        if (isLoading) return;
        if (!asOnDate) {
            const message = 'Please select an As On Date.';
            setError(message);
            toast({ title: 'Invalid filters', description: message, variant: 'destructive' });
            return;
        }
        setError(null);
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ asOnDate, mode, branchId });
            const res = await apiClient.get<BalanceSheetReport>(`/reports/balance-sheet?${params.toString()}`);
            if (!res.success || !res.data) throw new Error(res.message || res.error || 'Failed to generate report');
            setReport(res.data);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to generate report';
            setReport(null);
            setError(message);
            toast({ variant: 'destructive', title: 'Error', description: message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setReport(null);
        setError(null);
        setAsOnDate(todayYmd());
        setMode('GROUP');
        setBranchId(allowAll ? 'all' : branches[0]?.id ?? 'all');
    };

    const runExport = async (kind: 'pdf' | 'excel') => {
        if (!report || isExporting) return;
        setIsExporting(true);
        try {
            const base = balanceSheetFilenameBase(report);
            if (kind === 'excel') downloadBalanceSheetExcel(report, base);
            else {
                const { default: JsPdf } = await import('jspdf');
                const doc = new JsPdf({ orientation: 'landscape', format: 'a4' });
                const font = await ensureReportFont(doc);
                await drawBalanceSheetReport(doc, report, font);
                doc.save(`${base}.pdf`);
            }
            toast({ title: 'Export Successful', description: `Balance Sheet ${kind === 'pdf' ? 'PDF' : 'Excel'} downloaded.` });
        } catch (e) {
            console.error('Balance Sheet export error:', e);
            toast({ variant: 'destructive', title: 'Export Failed', description: `Failed to export ${kind === 'pdf' ? 'PDF' : 'Excel'}.` });
        } finally {
            setIsExporting(false);
        }
    };

    const lines = report ? buildBalanceSheetLines(report) : null;
    const hasData = !!report && (report.liabilities.length > 0 || report.assets.length > 0);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Balance Sheet</h1>
                <p className="text-sm text-muted-foreground">View liabilities and assets by branch as on a date</p>
            </div>

            <Card className="relative overflow-visible border-2 border-primary/20 shadow-xl">
                <div className="h-1.5 rounded-t-md bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <Filter className="h-5 w-5 text-primary" />
                        <div>
                            <CardTitle className="text-lg">Report Parameters</CardTitle>
                            <CardDescription>Select branch, date and report mode</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-2" ref={branchRef}>
                            <Label className="text-sm font-semibold">Branch <span className="text-red-500">*</span></Label>
                            <div className="relative">
                                <button
                                    type="button"
                                    disabled={isFetchingBranches}
                                    onClick={() => setBranchOpen((o) => !o)}
                                    className={cn('flex h-11 w-full items-center justify-between rounded-md border border-primary/30 bg-background px-3 text-sm', isFetchingBranches && 'opacity-60')}
                                >
                                    <span className="truncate">{isFetchingBranches ? 'Fetching...' : branchLabel}</span>
                                    {isFetchingBranches ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                                {branchOpen && (
                                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg">
                                        <div className="p-2">
                                            <Input autoFocus placeholder="Search branch..." value={branchSearch} onChange={(e) => setBranchSearch(e.target.value)} className="h-9" />
                                        </div>
                                        <div className="max-h-60 overflow-auto pb-1">
                                            {allowAll && (
                                                <button type="button" className={cn('w-full px-3 py-2 text-left text-sm hover:bg-muted', branchId === 'all' && 'font-medium text-primary')} onClick={() => { setBranchId('all'); setBranchOpen(false); setBranchSearch(''); }}>
                                                    All Branches
                                                </button>
                                            )}
                                            {filteredBranches.map((b) => (
                                                <button key={b.id} type="button" className={cn('w-full px-3 py-2 text-left text-sm hover:bg-muted', branchId === b.id && 'font-medium text-primary')} onClick={() => { setBranchId(b.id); setBranchOpen(false); setBranchSearch(''); }}>
                                                    {b.code} - {b.name}
                                                </button>
                                            ))}
                                            {filteredBranches.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No branches found</p>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="bsAsOn" className="text-sm font-semibold">As On Date <span className="text-red-500">*</span></Label>
                            <div className="relative">
                                <DateInput id="bsAsOn" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} className="h-11 border-primary/30 pl-10" />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">Report Mode <span className="text-red-500">*</span></Label>
                            <div role="radiogroup" aria-label="Report mode" className="grid h-11 grid-cols-2 overflow-hidden rounded-md border border-primary/30">
                                {(['GROUP', 'ACCOUNT'] as const).map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        role="radio"
                                        aria-checked={mode === m}
                                        onClick={() => setMode(m)}
                                        className={cn('px-2 text-sm font-medium transition-colors', mode === m ? 'bg-primary text-white' : 'bg-background hover:bg-muted')}
                                    >
                                        {balanceSheetModeLabel(m)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {error && <p role="alert" className="mt-4 text-sm font-medium text-red-600">{error}</p>}

                    <div className="mt-6 flex flex-wrap gap-2">
                        <Button onClick={handleGenerate} disabled={isLoading || isFetchingBranches} className="h-11 min-w-[160px] bg-primary text-white">
                            {isLoading ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Generating...</> : <><Search className="mr-2 h-4 w-4" /> Generate Report</>}
                        </Button>
                        <Button onClick={handleReset} variant="outline" disabled={isLoading} className="h-11 min-w-[120px] border-red-300 text-red-700 hover:bg-red-50">
                            Reset Filters
                        </Button>
                        {report && (
                            <ExportDropdown
                                onExportPDF={() => runExport('pdf')}
                                onExportExcel={() => runExport('excel')}
                                canExport={canExportReport('balance-sheet')}
                                className="h-11 min-w-[120px] border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/50"
                            />
                        )}
                        {report && (
                            <Button variant="outline" className="h-11" onClick={() => handlePrint()}>
                                <Printer className="mr-2 h-4 w-4" /> Print
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {report && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Card className="border-2 border-rose-200/60 bg-rose-50 dark:bg-rose-950/20">
                        <CardContent className="flex items-center justify-between pt-6">
                            <div>
                                <p className="text-sm font-medium text-rose-700">Total Liabilities</p>
                                <p className="mt-2 text-2xl font-bold tabular-nums text-rose-900">₹ {formatInr(report.totalLiabilities)}</p>
                            </div>
                            <TrendingDown className="h-8 w-8 text-rose-600" />
                        </CardContent>
                    </Card>
                    <Card className="border-2 border-emerald-200/60 bg-emerald-50 dark:bg-emerald-950/20">
                        <CardContent className="flex items-center justify-between pt-6">
                            <div>
                                <p className="text-sm font-medium text-emerald-700">Total Assets</p>
                                <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-900">₹ {formatInr(report.totalAssets)}</p>
                            </div>
                            <TrendingUp className="h-8 w-8 text-emerald-600" />
                        </CardContent>
                    </Card>
                    <Card className={cn('border-2', report.isBalanced ? 'border-primary/30 bg-green-50' : 'border-amber-300 bg-amber-50')}>
                        <CardContent className="flex items-center justify-between pt-6">
                            <div>
                                <p className={cn('text-sm font-medium', report.isBalanced ? 'text-primary' : 'text-amber-700')}>
                                    {report.isBalanced ? 'Balanced' : 'Out of balance'}
                                </p>
                                <p className="mt-2 text-2xl font-bold tabular-nums">₹ {formatInr(Math.abs(report.difference))}</p>
                            </div>
                            {report.isBalanced ? <CheckCircle2 className="h-8 w-8 text-primary" /> : <AlertCircle className="h-8 w-8 text-amber-600" />}
                        </CardContent>
                    </Card>
                </div>
            )}

            {report && lines && (
                <Card className="overflow-hidden rounded-none border-0 bg-white text-black shadow-none">
                    <div ref={printRef}>
                        <div className="p-4 text-center">
                            <ReportHeader
                                title="BALANCE SHEET"
                                subtitle={`${report.meta.branchLabel}  •  As On ${formatDmy(report.meta.asOnDate)}  •  ${balanceSheetModeLabel(report.meta.mode)}  •  Generated ${report.meta.generatedAt}`}
                            />
                        </div>
                        <CardContent className="p-0">
                            {report.unclassified.length > 0 && (
                                <p className="mx-4 mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    {report.unclassified.length} ledger(s) sit under a group that is not Assets, Liabilities, Income or Expenses and were left out:{' '}
                                    {report.unclassified.slice(0, 5).map((u) => `${u.accountName} (${u.groupName})`).join(', ')}
                                    {report.unclassified.length > 5 ? '…' : ''}
                                </p>
                            )}
                            {!report.isBalanced && (
                                <p className="mx-4 mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    Assets and Liabilities differ by ₹ {formatInr(Math.abs(report.difference))}. Nothing has been added to force a match — check the Trial Balance and ledger classification for this branch and date.
                                </p>
                            )}
                            {!hasData ? (
                                <p className="py-10 text-center text-sm text-slate-600">No asset or liability balances found for the selected branch and date.</p>
                            ) : (
                                <div className="grid grid-cols-1 border border-black md:grid-cols-2 md:divide-x md:divide-black">
                                    <BsColumn title="Liabilities" lines={lines.left} />
                                    <BsColumn title="Assets" lines={lines.right} />
                                </div>
                            )}
                            <div className="px-4 pb-6 pt-4 text-right text-xs text-slate-600">
                                <p>For {report.meta.companyName}</p>
                                <p className="mt-6">Authorised Signatory</p>
                            </div>
                        </CardContent>
                    </div>
                </Card>
            )}
        </div>
    );
}
