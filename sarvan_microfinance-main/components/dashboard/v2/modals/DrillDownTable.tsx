'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

export interface DrillDownColumn<T> {
    key: string;
    label: string;
    align?: 'left' | 'center' | 'right';
    render?: (row: T) => React.ReactNode;
    /** Value used for search/sort/Excel export. Defaults to `row[key]` when omitted. */
    value?: (row: T) => string | number;
    sortable?: boolean;
    /**
     * Computes this column's value for the totals row appended to the Excel export.
     * Should replicate the same math the call site's `footer` render-prop uses for its
     * on-screen `<tfoot>` total. Columns without a `footerValue` are left blank ('') in
     * the totals row, except the first column which is labeled "Total".
     */
    footerValue?: (rows: T[]) => string | number;
}

interface Props<T> {
    columns: DrillDownColumn<T>[];
    rows: T[];
    searchPlaceholder?: string;
    /** Renders the sticky footer <tr>(s) from the post-search row set (before pagination). */
    footer?: (rows: T[]) => React.ReactNode;
    exportFileName: string;
    exportSheetName?: string;
    isLoading?: boolean;
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
        <div className="flex shrink-0 items-center justify-between border-t border-primary/20 px-4 py-3 dark:border-sidebar-accent">
            <span className="text-xs text-slate-500 dark:text-slate-400">
                Showing {start}–{end} of {total}
            </span>
            <div className="flex items-center gap-2 text-xs">
                <select
                    value={pageSize}
                    onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
                    className="rounded border border-primary/20 bg-white px-2 py-1 text-sidebar-accent dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-300"
                >
                    {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <button disabled={page === 1} onClick={() => onPage(page - 1)}
                    className="rounded px-2 py-1 text-sidebar-accent hover:bg-brand-green-tint disabled:opacity-40 dark:text-slate-400 dark:hover:bg-sidebar-accent">← Prev</button>
                <span className="font-medium text-sidebar-accent dark:text-slate-300">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}
                    className="rounded px-2 py-1 text-sidebar-accent hover:bg-brand-green-tint disabled:opacity-40 dark:text-slate-400 dark:hover:bg-sidebar-accent">Next →</button>
            </div>
        </div>
    );
}

export function DrillDownTable<T>({
    columns, rows, searchPlaceholder, footer, exportFileName, exportSheetName, isLoading,
}: Props<T>) {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const getValue = (col: DrillDownColumn<T>, row: T): string | number =>
        col.value ? col.value(row) : ((row as Record<string, unknown>)[col.key] as string | number) ?? '';

    const filteredRows = useMemo(() => {
        if (!search.trim()) return rows;
        const q = search.trim().toLowerCase();
        return rows.filter((row) => columns.some((col) => String(getValue(col, row) ?? '').toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, search, columns]);

    const sortedRows = useMemo(() => {
        if (!sortKey) return filteredRows;
        const col = columns.find((c) => c.key === sortKey);
        if (!col) return filteredRows;
        const copy = [...filteredRows];
        copy.sort((a, b) => {
            const av = getValue(col, a);
            const bv = getValue(col, b);
            if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
            return sortDir === 'asc'
                ? String(av ?? '').localeCompare(String(bv ?? ''))
                : String(bv ?? '').localeCompare(String(av ?? ''));
        });
        return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredRows, sortKey, sortDir, columns]);

    useEffect(() => { setPage(1); }, [search, rows]);

    const start = (page - 1) * pageSize;
    const pageRows = sortedRows.slice(start, start + pageSize);

    const handleSort = (key: string, sortable?: boolean) => {
        if (sortable === false) return;
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir('asc'); }
    };

    const handleExport = async () => {
        const XLSX = await import('xlsx');
        // Export the post-search, pre-pagination row set — "all filtered records", not just
        // the on-screen page.
        const exportData = sortedRows.map((row) => {
            const obj: Record<string, string | number> = {};
            for (const col of columns) obj[col.label] = getValue(col, row);
            return obj;
        });
        // Append the same totals the on-screen `footer` render-prop shows, so the Excel
        // export doesn't silently omit the summary row. Columns declare their own total
        // via `footerValue`; columns without one are left blank.
        if (sortedRows.length > 0 && columns.some((col) => col.footerValue)) {
            const totalsRow: Record<string, string | number> = {};
            columns.forEach((col, i) => {
                if (col.footerValue) totalsRow[col.label] = col.footerValue(sortedRows);
                else totalsRow[col.label] = i === 0 ? 'Total' : '';
            });
            exportData.push(totalsRow);
        }
        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, exportSheetName ?? 'Data');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `${exportFileName}.xlsx`);
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary/20 px-4 py-3 dark:border-sidebar-accent">
                <div className="relative w-full max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={searchPlaceholder ?? 'Search...'}
                        className="w-full rounded-lg border border-primary/20 bg-green-50 py-1.5 pl-8 pr-3 text-sm text-sidebar-accent focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-100"
                    />
                </div>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sidebar-accent"
                >
                    <Download className="h-4 w-4" />
                    Export Excel
                </button>
            </div>

            <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-green-50 dark:bg-sidebar-accent/60">
                        <tr>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    onClick={() => handleSort(col.key, col.sortable)}
                                    className={cn(
                                        'whitespace-nowrap border-b border-r border-primary/20 px-3 py-2.5 font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400',
                                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                                        col.sortable !== false && 'cursor-pointer select-none hover:bg-brand-green-tint dark:hover:bg-sidebar-accent'
                                    )}
                                >
                                    {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                        {isLoading ? (
                            <tr><td colSpan={columns.length} className="py-10 text-center text-slate-400 dark:text-sidebar-accent">Loading…</td></tr>
                        ) : pageRows.length === 0 ? (
                            <tr><td colSpan={columns.length} className="py-10 text-center text-slate-400 dark:text-sidebar-accent">No records found.</td></tr>
                        ) : (
                            pageRows.map((row, i) => (
                                <tr key={i} className="transition-colors hover:bg-green-50 dark:hover:bg-sidebar-accent/40">
                                    {columns.map((col) => (
                                        <td
                                            key={col.key}
                                            className={cn(
                                                'whitespace-nowrap border-r border-slate-100 px-3 py-2 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300',
                                                col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                                            )}
                                        >
                                            {col.render ? col.render(row) : String(getValue(col, row) ?? '-')}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                    {footer && sortedRows.length > 0 && !isLoading && (
                        <tfoot className="sticky bottom-0 border-t-2 border-primary/30 bg-brand-green-tint font-semibold dark:border-sidebar-accent/60 dark:bg-sidebar-accent">
                            {footer(sortedRows)}
                        </tfoot>
                    )}
                </table>
            </div>

            {sortedRows.length > 0 && (
                <PaginationBar
                    page={page}
                    pageSize={pageSize}
                    total={sortedRows.length}
                    onPage={setPage}
                    onPageSize={(s) => { setPageSize(s); setPage(1); }}
                />
            )}
        </div>
    );
}
