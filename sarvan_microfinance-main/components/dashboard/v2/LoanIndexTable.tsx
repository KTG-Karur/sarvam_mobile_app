'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { FileText, Download } from 'lucide-react';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

export interface LoanIndexRow {
    indexNo: string;
    disbursementDate: string;
    branch: string;
    center: string;
    loanAmount: number;
    membersCount: number;
    disbursedCount: number;
    principal: number;
    interest: number;
    frequency: string;
    status: string;
}

function fmtDate(iso: string) {
    try {
        return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).format(new Date(iso));
    } catch {
        return iso;
    }
}

function fmtCur(n: number) {
    if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;
}

const STATUS_STYLE: Record<string, string> = {
    'Fully Disbursed': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
    'Partially Disbursed': 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
    'Pending': 'bg-brand-green-tint text-sidebar-accent dark:bg-sidebar-accent dark:text-slate-400',
};

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

export function LoanIndexTable({ data }: { data?: LoanIndexRow[] }) {
    const rows = data ?? [];
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => { setPage(1); }, [rows]);

    const totalPages = Math.ceil(rows.length / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const handleExportExcel = async () => {
        const XLSX = await import('xlsx');
        const exportData: Record<string, string | number>[] = rows.map((r, i) => ({
            'S.No': i + 1,
            'Index No': r.indexNo,
            'Date': r.disbursementDate,
            'Status': r.status,
            'Branch': r.branch,
            'Center': r.center,
            'Loan Amount': r.loanAmount,
            'Principal': r.principal,
            'Interest Paid': r.interest,
            'Members': r.membersCount,
            'Disbursed': r.disbursedCount,
        }));
        if (rows.length > 0) {
            exportData.push({
                'S.No': `Total (${rows.length} indexes)`,
                'Index No': '',
                'Date': '',
                'Status': '',
                'Branch': '',
                'Center': '',
                'Loan Amount': rows.reduce((s, r) => s + r.loanAmount, 0),
                'Principal': rows.reduce((s, r) => s + r.principal, 0),
                'Interest Paid': rows.reduce((s, r) => s + r.interest, 0),
                'Members': rows.reduce((s, r) => s + r.membersCount, 0),
                'Disbursed': '',
            });
        }
        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Loan Indexes');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `loan-indexes-${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    return (
        <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
            <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-violet-700 px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                            <FileText className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Loan Index Details</h3>
                            <p className="text-sm text-violet-100">Recent loan indexes and disbursement summary</p>
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
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">#</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Index No</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Branch</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Center</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Loan Amt</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Principal</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Interest Pd</th>
                            <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-sidebar-accent dark:text-slate-400">Members</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                        {pageRows.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="py-10 text-center text-slate-400 dark:text-sidebar-accent">
                                    No loan index data available.
                                </td>
                            </tr>
                        ) : (
                            pageRows.map((row, i) => (
                                <tr
                                    key={row.indexNo}
                                    className={cn(
                                        'transition-colors hover:bg-violet-50/30 dark:hover:bg-sidebar-accent/40',
                                        i % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/40 dark:bg-brand-green-darker/40'
                                    )}
                                >
                                    <td className="px-4 py-3 text-slate-400 dark:text-sidebar-accent">{start + i + 1}</td>
                                    <td className="px-4 py-3 font-medium text-violet-700 dark:text-violet-400">{row.indexNo}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sidebar-accent dark:text-slate-400">{fmtDate(row.disbursementDate)}</td>
                                    <td className="px-4 py-3">
                                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_STYLE[row.status] ?? STATUS_STYLE['Pending'])}>
                                            {row.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sidebar-accent dark:text-slate-300">{row.branch}</td>
                                    <td className="px-4 py-3 text-sidebar-accent dark:text-slate-300">{row.center}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-sidebar-accent dark:text-slate-200">{fmtCur(row.loanAmount)}</td>
                                    <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-300">{fmtCur(row.principal)}</td>
                                    <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">{fmtCur(row.interest)}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="font-medium text-sidebar-accent dark:text-slate-300">
                                            {row.disbursedCount}/{row.membersCount}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t-2 border-primary/30 bg-brand-green-tint font-semibold dark:border-sidebar-accent/60 dark:bg-sidebar-accent">
                                <td colSpan={6} className="px-4 py-3 text-sidebar-accent dark:text-slate-300">Total ({rows.length} indexes)</td>
                                <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                    {fmtCur(rows.reduce((s, r) => s + r.loanAmount, 0))}
                                </td>
                                <td className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-300">
                                    {fmtCur(rows.reduce((s, r) => s + r.principal, 0))}
                                </td>
                                <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                                    {fmtCur(rows.reduce((s, r) => s + r.interest, 0))}
                                </td>
                                <td className="px-4 py-3 text-center text-sidebar-accent dark:text-slate-300">
                                    {rows.reduce((s, r) => s + r.membersCount, 0)}
                                </td>
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
