'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, Calendar, Download } from 'lucide-react';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

export interface EODRowV2 {
    branch: string;
    eodDate: string;
    doneAt: string;
    status: 'Completed' | 'In Progress' | 'Pending';
    cashOpening: number;
    cashClosing: number;
    bankOpening: number;
    bankClosing: number;
    managerName: string;
    managerContact: string;
}

function StatusBadge({ status }: { status: EODRowV2['status'] }) {
    const cfg = {
        Completed: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' },
        'In Progress': { icon: Clock, cls: 'bg-green-50 text-sidebar-accent dark:bg-green-950/30 dark:text-primary' },
        Pending: { icon: Clock, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
    };
    const { icon: Icon, cls } = cfg[status];
    return (
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', cls)}>
            <Icon className="h-3.5 w-3.5" />
            {status}
        </span>
    );
}

function fmtCur(n: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(ymd: string) {
    try {
        const [y, m, d] = ymd.split('-').map(Number);
        return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
            .format(new Date(y, m - 1, d));
    } catch { return ymd; }
}

function PaginationBar({
    page, pageSize, total, onPage, onPageSize,
}: {
    page: number; pageSize: number; total: number;
    onPage: (p: number) => void; onPageSize: (s: number) => void;
}) {
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    return (
        <div className="flex items-center justify-between border-t border-primary/20 px-4 py-3 dark:border-sidebar-accent">
            <span className="text-xs text-slate-500 dark:text-slate-400">
                Showing {start}–{end} of {total}
            </span>
            <div className="flex items-center gap-2 text-xs">
                <select
                    value={pageSize}
                    onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
                    className="rounded border border-primary/20 bg-white px-2 py-1 text-sidebar-accent dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-300"
                >
                    {[5, 10, 20].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <button
                    disabled={page === 1}
                    onClick={() => onPage(page - 1)}
                    className="rounded px-2 py-1 text-sidebar-accent hover:bg-brand-green-tint disabled:opacity-40 dark:text-slate-400 dark:hover:bg-sidebar-accent"
                >
                    ← Prev
                </button>
                <span className="font-medium text-sidebar-accent dark:text-slate-300">{page} / {totalPages}</span>
                <button
                    disabled={page >= totalPages}
                    onClick={() => onPage(page + 1)}
                    className="rounded px-2 py-1 text-sidebar-accent hover:bg-brand-green-tint disabled:opacity-40 dark:text-slate-400 dark:hover:bg-sidebar-accent"
                >
                    Next →
                </button>
            </div>
        </div>
    );
}

export function EODStatusTableV2({ data }: { data?: EODRowV2[] }) {
    const rows = data ?? [];
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => { setPage(1); }, [rows]);

    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const handleExportExcel = async () => {
        const XLSX = await import('xlsx');
        const exportData: Record<string, string | number>[] = rows.map((r) => ({
            'Branch': r.branch,
            'EOD Date': r.eodDate,
            'Cash Opening': r.cashOpening,
            'Cash Closing': r.cashClosing,
            'Bank Opening': r.bankOpening,
            'Bank Closing': r.bankClosing,
            'EOD Status': r.status,
            'Done At': r.doneAt,
            'Manager': r.managerName,
            'Contact': r.managerContact,
        }));
        if (rows.length > 0) {
            exportData.push({
                'Branch': `Total (${rows.length} branches)`,
                'EOD Date': '',
                'Cash Opening': rows.reduce((s, r) => s + r.cashOpening, 0),
                'Cash Closing': rows.reduce((s, r) => s + r.cashClosing, 0),
                'Bank Opening': rows.reduce((s, r) => s + r.bankOpening, 0),
                'Bank Closing': rows.reduce((s, r) => s + r.bankClosing, 0),
                'EOD Status': '',
                'Done At': '',
                'Manager': '',
                'Contact': '',
            });
        }
        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'EOD Status');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `eod-status-${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    return (
        <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
            <div className="bg-gradient-to-r from-primary via-purple-600 to-primary px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                            <Calendar className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">End of Day Status</h3>
                            <p className="text-sm text-primary">Branch-wise daily cash and bank balance summary</p>
                        </div>
                    </div>
                    <button
                        onClick={handleExportExcel}
                        className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/30"
                    >
                        <Download className="h-4 w-4" />
                        Export Excel
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b-2 border-primary/20 bg-green-50 dark:border-sidebar-accent dark:bg-sidebar-accent/60">
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Branch</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">EOD Date</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Cash Opening</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Cash Closing</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Bank Opening</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Bank Closing</th>
                            <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">EOD Status</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Done At</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Manager</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                        {pageRows.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="py-10 text-center text-slate-400 dark:text-sidebar-accent">
                                    No EOD data available.
                                </td>
                            </tr>
                        ) : (
                            pageRows.map((row, i) => (
                                <tr
                                    key={row.branch}
                                    className={cn(
                                        'transition-colors hover:bg-green-50/30 dark:hover:bg-sidebar-accent/40',
                                        i % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/40 dark:bg-brand-green-darker/40'
                                    )}
                                >
                                    <td className="px-4 py-3 font-semibold text-sidebar-accent dark:text-slate-200">{row.branch}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sidebar-accent dark:text-slate-400">{fmtDate(row.eodDate)}</td>
                                    <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-300">{fmtCur(row.cashOpening)}</td>
                                    <td className={cn('px-4 py-3 text-right font-semibold', row.cashClosing >= row.cashOpening ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                                        {fmtCur(row.cashClosing)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-300">{fmtCur(row.bankOpening)}</td>
                                    <td className={cn('px-4 py-3 text-right font-semibold', row.bankClosing >= row.bankOpening ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                                        {fmtCur(row.bankClosing)}
                                    </td>
                                    <td className="px-4 py-3 text-center"><StatusBadge status={row.status} /></td>
                                    <td className="px-4 py-3 text-sidebar-accent dark:text-slate-400">{row.doneAt || '—'}</td>
                                    <td className="px-4 py-3 text-sidebar-accent dark:text-slate-300">{row.managerName || '—'}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t-2 border-primary/30 bg-brand-green-tint font-semibold dark:border-sidebar-accent/60 dark:bg-sidebar-accent">
                                <td colSpan={2} className="px-4 py-3 text-sidebar-accent dark:text-slate-300">Total ({rows.length} branches)</td>
                                <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-300">{fmtCur(rows.reduce((s, r) => s + r.cashOpening, 0))}</td>
                                <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">{fmtCur(rows.reduce((s, r) => s + r.cashClosing, 0))}</td>
                                <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-300">{fmtCur(rows.reduce((s, r) => s + r.bankOpening, 0))}</td>
                                <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">{fmtCur(rows.reduce((s, r) => s + r.bankClosing, 0))}</td>
                                <td colSpan={3} />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {rows.length > 0 && (
                <PaginationBar
                    page={page}
                    pageSize={pageSize}
                    total={rows.length}
                    onPage={setPage}
                    onPageSize={(s) => { setPageSize(s); setPage(1); }}
                />
            )}
        </div>
    );
}
