'use client';

import { AlertCircle } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { EodDetailRow, EodDetailSection, EodRowAccent } from '@/app/types/eod-checklist-details';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';

// Stable reference so useTableSearch's internal useMemo (keyed on [rows]) doesn't
// rebuild its haystack every render while section/rows is still unavailable.
const EMPTY_ROWS: EodDetailRow[] = [];

const ATTENTION_ROW_ACCENTS = new Set<EodRowAccent>([
    'pending-collection',
    'indexed-pending-disburse',
    'unindexed-pending-index',
    'center-meeting-pending',
]);

function isAttentionRow(row: EodDetailRow): boolean {
    return row._rowAccent != null && ATTENTION_ROW_ACCENTS.has(row._rowAccent);
}

function attentionRowAriaLabel(row: EodDetailRow): string | undefined {
    switch (row._rowAccent) {
        case 'pending-collection':
            return 'Pending BM collection batch approval';
        case 'indexed-pending-disburse':
            return 'Indexed but not yet disbursed';
        case 'unindexed-pending-index':
            return 'Unindexed loan pending indexation';
        case 'center-meeting-pending':
            return 'Center meeting or demand collection pending per EOD rules';
        default:
            return undefined;
    }
}

function tableRowClassName(row: EodDetailRow, rowIndex: number): string {
    if (isAttentionRow(row)) {
        return 'border-l-[5px] border-l-amber-500 bg-amber-50 hover:bg-amber-100/90 dark:border-l-amber-400 dark:bg-amber-950/45 dark:hover:bg-amber-950/70';
    }
    return rowIndex % 2 === 0
        ? 'bg-white dark:bg-green-950'
        : 'bg-green-50/90 dark:bg-brand-green-darker/80';
}

function attentionBannerText(sectionCode: number): string | null {
    if (sectionCode === 8) {
        return 'Amber-highlighted rows need disbursement or indexation (see Pipeline column).';
    }
    if (sectionCode === 5) {
        return 'Amber-highlighted rows fail the center meeting check (FDO present vs demand collection, or no activity if FDO absent/unassigned).';
    }
    return null;
}

type EodChecklistDetailPanelProps = {
    section: EodDetailSection | undefined;
    loading: boolean;
    error: string | null;
    checklistSummary: {
        status: string;
        issue: boolean;
        informational?: boolean;
        details?: string;
    };
};

export function EodChecklistDetailPanel({
    section,
    loading,
    error,
    checklistSummary,
}: EodChecklistDetailPanelProps) {
    // Hook must run unconditionally (before the loading/error/!section early
    // returns below) — this dialog is instantiated once per checklist row inside
    // a parent .map(), so the search state has to live here rather than in the
    // parent (which can't call a hook per iteration).
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(
        section?.rows ?? EMPTY_ROWS
    );

    if (loading) {
        return <PageLoader label="Loading detailed report…" fullScreen={false} />;
    }

    if (error) {
        return (
            <div
                className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
                role="alert"
            >
                <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
                <p className="text-sm">{error}</p>
            </div>
        );
    }

    if (!section) {
        return (
            <p className="py-8 text-center text-sm text-sidebar-accent dark:text-slate-400">
                Detailed data is not available for this item.
            </p>
        );
    }

    const hasRows = section.rows.length > 0;
    // Derived from the FULL row set (not the search-filtered one) so the
    // warning banner doesn't disappear just because a query hides the rows it refers to.
    const attentionBanner =
        section.code === 8 &&
        section.rows.some((r) => isAttentionRow(r))
            ? attentionBannerText(section.code)
            : null;
    const hasSearchedRows = searchedRows.length > 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-md border border-primary/20 bg-green-50 p-3 text-sm dark:border-sidebar-accent/60 dark:bg-brand-green-darker/50">
                <p className="font-medium text-sidebar-accent dark:text-slate-100">Checklist summary</p>
                <p className="mt-1 text-sidebar-accent dark:text-slate-300">
                    {checklistSummary.informational ? 'Summary' : 'Status'}:{' '}
                    <span
                        className={
                            checklistSummary.informational
                                ? 'font-semibold text-foreground'
                                : checklistSummary.issue
                                  ? 'font-semibold text-red-600 dark:text-red-400'
                                  : 'font-semibold text-emerald-700 dark:text-emerald-400'
                        }
                    >
                        {checklistSummary.status}
                    </span>
                </p>
                {checklistSummary.details ? (
                    <p className="mt-1 text-sidebar-accent dark:text-slate-400">{checklistSummary.details}</p>
                ) : null}
            </div>

            {hasRows && (
                <div className="flex justify-end">
                    <TableSearchInput
                        value={tableSearchQuery}
                        onChange={setTableSearchQuery}
                        placeholder="Search this report..."
                    />
                </div>
            )}

            <div className="overflow-hidden rounded-md border-2 border-brand-green-darker shadow-sm dark:border-sidebar-accent">
                <div className="bg-brand-green-darker px-4 py-2 dark:bg-green-950">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-white">{section.title}</h3>
                </div>
                {attentionBanner ? (
                    <div
                        className="flex items-center gap-2 border-b border-amber-300/80 bg-amber-100/90 px-4 py-2.5 text-xs font-semibold text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-100"
                        role="note"
                    >
                        <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-amber-500 dark:bg-amber-400"
                            aria-hidden
                        />
                        {attentionBanner}
                    </div>
                ) : null}
                <div className="max-h-[min(420px,55vh)] overflow-auto bg-white dark:bg-green-950">
                    {!hasRows ? (
                        <p className="px-4 py-10 text-center text-sm text-sidebar-accent dark:text-slate-400">
                            {section.emptyMessage}
                        </p>
                    ) : !hasSearchedRows ? (
                        <p className="px-4 py-10 text-center text-sm text-sidebar-accent dark:text-slate-400">
                            No rows match your search.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 z-[1] bg-brand-green-darker shadow-sm">
                                <TableRow className="border-none hover:bg-brand-green-darker">
                                    {section.columns.map((col) => (
                                        <TableHead
                                            key={col.key}
                                            className={`whitespace-nowrap border-r border-sidebar-accent/80 text-xs font-bold uppercase tracking-wide text-white last:border-r-0 ${
                                                col.align === 'right' ? 'text-right' : 'text-left'
                                            }`}
                                        >
                                            {col.label}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows.map((row, rowIndex) => {
                                    const attention = isAttentionRow(row);
                                    return (
                                    <TableRow
                                        key={rowIndex}
                                        className={tableRowClassName(row, rowIndex)}
                                        aria-label={attentionRowAriaLabel(row)}
                                    >
                                        {section.columns.map((col) => (
                                            <TableCell
                                                key={col.key}
                                                className={`max-w-[280px] truncate px-3 py-2.5 text-xs sm:max-w-none sm:whitespace-normal ${
                                                    attention
                                                        ? 'border-b border-amber-200/90 font-medium text-amber-950 dark:border-amber-800/50 dark:text-amber-50'
                                                        : 'border-b border-slate-100 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-200'
                                                } ${
                                                    col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                                                }`}
                                                title={String(row[col.key] ?? '')}
                                            >
                                                {row[col.key] ?? '—'}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
        </div>
    );
}
