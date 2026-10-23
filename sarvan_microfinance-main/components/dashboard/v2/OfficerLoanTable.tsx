'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { UserCircle, Download } from 'lucide-react';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

export interface OfficerLoanRow {
    officerName: string;
    groups: number;
    members: number;
    activeMembers: number;
    publishedPrincipal: number;
    publishedInterest: number;
    publishedTotal: number;
    unpublishedPrincipal: number;
    unpublishedInterest: number;
    unpublishedTotal: number;
    olbPrincipal: number;
    olbInterest: number;
    olbTotal: number;
}

function fmtCur(n: number) {
    if (n === 0) return '—';
    if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;
}

function num(n: number) {
    return n === 0 ? '—' : new Intl.NumberFormat('en-IN').format(n);
}

function sumField(rows: OfficerLoanRow[], field: keyof OfficerLoanRow): number {
    return rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
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

export function OfficerLoanTable({ data }: { data?: OfficerLoanRow[] }) {
    const rows = data ?? [];
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => { setPage(1); }, [rows]);

    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const handleExportExcel = async () => {
        const XLSX = await import('xlsx');
        const exportData: Record<string, string | number>[] = rows.map((r) => ({
            'Officer Name': r.officerName,
            'Groups': r.groups,
            'Members': r.members,
            'Active Members': r.activeMembers,
            'Published Principal': r.publishedPrincipal,
            'Published Interest': r.publishedInterest,
            'Published Total': r.publishedTotal,
            'Unpublished Principal': r.unpublishedPrincipal,
            'Unpublished Interest': r.unpublishedInterest,
            'Unpublished Total': r.unpublishedTotal,
            'OLB Principal': r.olbPrincipal,
            'OLB Interest': r.olbInterest,
            'OLB Total': r.olbTotal,
        }));
        if (rows.length > 0) {
            exportData.push({
                'Officer Name': `Total (${rows.length} officers)`,
                'Groups': '',
                'Members': '',
                'Active Members': '',
                'Published Principal': sumField(rows, 'publishedPrincipal'),
                'Published Interest': sumField(rows, 'publishedInterest'),
                'Published Total': sumField(rows, 'publishedTotal'),
                'Unpublished Principal': sumField(rows, 'unpublishedPrincipal'),
                'Unpublished Interest': sumField(rows, 'unpublishedInterest'),
                'Unpublished Total': sumField(rows, 'unpublishedTotal'),
                'OLB Principal': sumField(rows, 'olbPrincipal'),
                'OLB Interest': sumField(rows, 'olbInterest'),
                'OLB Total': sumField(rows, 'olbTotal'),
            });
        }
        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Officer Loan Details');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `officer-loan-details-${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    return (
        <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
            <div className="bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-700 px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                            <UserCircle className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Officer Loan Details</h3>
                            <p className="text-sm text-teal-100">Published / unpublished loan issue and outstanding balance per FDO</p>
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
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-green-50 dark:bg-sidebar-accent/60">
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-left font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>
                                Officer Name
                            </th>
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>
                                Groups
                            </th>
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>
                                Members
                            </th>
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>
                                Active
                            </th>
                            <th className="border-b border-r border-primary/20 bg-emerald-50 px-3 py-2.5 text-center font-semibold text-emerald-700 dark:border-sidebar-accent dark:bg-emerald-950/20 dark:text-emerald-400" colSpan={3}>
                                Published Loan Issue
                            </th>
                            <th className="border-b border-r border-primary/20 bg-amber-50 px-3 py-2.5 text-center font-semibold text-amber-700 dark:border-sidebar-accent dark:bg-amber-950/20 dark:text-amber-400" colSpan={3}>
                                Unpublished Loan Issue
                            </th>
                            <th className="border-b border-primary/20 bg-green-50 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:bg-green-950/20 dark:text-primary" colSpan={3}>
                                OLB
                            </th>
                        </tr>
                        <tr className="bg-green-50 dark:bg-sidebar-accent/60">
                            <th className="border-b border-r border-primary/20 bg-emerald-50/70 px-3 py-2 text-center font-medium text-emerald-600 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400">P</th>
                            <th className="border-b border-r border-primary/20 bg-emerald-50/70 px-3 py-2 text-center font-medium text-emerald-600 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400">I</th>
                            <th className="border-b border-r border-primary/20 bg-emerald-50/70 px-3 py-2 text-center font-medium text-emerald-600 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400">Total</th>
                            <th className="border-b border-r border-primary/20 bg-amber-50/70 px-3 py-2 text-center font-medium text-amber-600 dark:border-sidebar-accent dark:bg-amber-950/10 dark:text-amber-400">P</th>
                            <th className="border-b border-r border-primary/20 bg-amber-50/70 px-3 py-2 text-center font-medium text-amber-600 dark:border-sidebar-accent dark:bg-amber-950/10 dark:text-amber-400">I</th>
                            <th className="border-b border-r border-primary/20 bg-amber-50/70 px-3 py-2 text-center font-medium text-amber-600 dark:border-sidebar-accent dark:bg-amber-950/10 dark:text-amber-400">Total</th>
                            <th className="border-b border-r border-primary/20 bg-green-50/70 px-3 py-2 text-center font-medium text-primary dark:border-sidebar-accent dark:bg-green-950/10 dark:text-primary">P</th>
                            <th className="border-b border-r border-primary/20 bg-green-50/70 px-3 py-2 text-center font-medium text-primary dark:border-sidebar-accent dark:bg-green-950/10 dark:text-primary">I</th>
                            <th className="border-b border-primary/20 bg-green-50/70 px-3 py-2 text-center font-medium text-primary dark:border-sidebar-accent dark:bg-green-950/10 dark:text-primary">Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                        {pageRows.length === 0 ? (
                            <tr>
                                <td colSpan={13} className="py-10 text-center text-slate-400 dark:text-sidebar-accent">
                                    No officer data available.
                                </td>
                            </tr>
                        ) : (
                            pageRows.map((row, i) => (
                                <tr
                                    key={row.officerName + (start + i)}
                                    className={cn(
                                        'transition-colors hover:bg-teal-50/30 dark:hover:bg-sidebar-accent/40',
                                        i % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/40 dark:bg-brand-green-darker/40'
                                    )}
                                >
                                    <td className="border-r border-slate-100 px-3 py-2.5 font-medium text-sidebar-accent dark:border-sidebar-accent dark:text-slate-200">
                                        {row.officerName}
                                    </td>
                                    <td className="border-r border-slate-100 px-3 py-2.5 text-center text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400">{num(row.groups)}</td>
                                    <td className="border-r border-slate-100 px-3 py-2.5 text-center text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400">{num(row.members)}</td>
                                    <td className="border-r border-slate-100 px-3 py-2.5 text-center font-medium text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{num(row.activeMembers)}</td>
                                    <td className="border-r border-slate-100 bg-emerald-50/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:bg-emerald-950/5 dark:text-emerald-400">{fmtCur(row.publishedPrincipal)}</td>
                                    <td className="border-r border-slate-100 bg-emerald-50/20 px-3 py-2.5 text-right text-emerald-600 dark:border-sidebar-accent dark:bg-emerald-950/5 dark:text-emerald-400">{fmtCur(row.publishedInterest)}</td>
                                    <td className="border-r border-slate-100 bg-emerald-50/20 px-3 py-2.5 text-right font-semibold text-emerald-700 dark:border-sidebar-accent dark:bg-emerald-950/5 dark:text-emerald-400">{fmtCur(row.publishedTotal)}</td>
                                    <td className="border-r border-slate-100 bg-amber-50/20 px-3 py-2.5 text-right text-amber-700 dark:border-sidebar-accent dark:bg-amber-950/5 dark:text-amber-400">{fmtCur(row.unpublishedPrincipal)}</td>
                                    <td className="border-r border-slate-100 bg-amber-50/20 px-3 py-2.5 text-right text-amber-600 dark:border-sidebar-accent dark:bg-amber-950/5 dark:text-amber-400">{fmtCur(row.unpublishedInterest)}</td>
                                    <td className="border-r border-slate-100 bg-amber-50/20 px-3 py-2.5 text-right font-semibold text-amber-700 dark:border-sidebar-accent dark:bg-amber-950/5 dark:text-amber-400">{fmtCur(row.unpublishedTotal)}</td>
                                    <td className="border-r border-slate-100 bg-green-50/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:bg-green-950/5 dark:text-primary">{fmtCur(row.olbPrincipal)}</td>
                                    <td className="border-r border-slate-100 bg-green-50/20 px-3 py-2.5 text-right text-primary dark:border-sidebar-accent dark:bg-green-950/5 dark:text-primary">{fmtCur(row.olbInterest)}</td>
                                    <td className="bg-green-50/20 px-3 py-2.5 text-right font-semibold text-sidebar-accent dark:bg-green-950/5 dark:text-primary">{fmtCur(row.olbTotal)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t-2 border-primary/30 bg-brand-green-tint font-semibold dark:border-sidebar-accent/60 dark:bg-sidebar-accent">
                                <td colSpan={4} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">
                                    Total ({rows.length} officers)
                                </td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{fmtCur(sumField(rows, 'publishedPrincipal'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{fmtCur(sumField(rows, 'publishedInterest'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{fmtCur(sumField(rows, 'publishedTotal'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-amber-700 dark:border-sidebar-accent dark:text-amber-400">{fmtCur(sumField(rows, 'unpublishedPrincipal'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-amber-700 dark:border-sidebar-accent dark:text-amber-400">{fmtCur(sumField(rows, 'unpublishedInterest'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-amber-700 dark:border-sidebar-accent dark:text-amber-400">{fmtCur(sumField(rows, 'unpublishedTotal'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-primary">{fmtCur(sumField(rows, 'olbPrincipal'))}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-primary">{fmtCur(sumField(rows, 'olbInterest'))}</td>
                                <td className="px-3 py-2.5 text-right text-sidebar-accent dark:text-primary">{fmtCur(sumField(rows, 'olbTotal'))}</td>
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
