'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { BarChart3, Download } from 'lucide-react';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import type { DashboardFilters } from './DashboardFiltersBar';
import { GroupLoanDetailsModal } from './modals/GroupLoanDetailsModal';
import { CenterLoanDetailsModal } from './modals/CenterLoanDetailsModal';
import { CollectionDetailsModal, CollectionMode } from './modals/CollectionDetailsModal';
import { OverdueModal } from './modals/OverdueModal';
import { ArrearOverdueModal } from './modals/ArrearOverdueModal';
import { ZeroCollectionDetailsModal } from './modals/ZeroCollectionDetailsModal';

const EMPTY_FILTERS: DashboardFilters = {
    branchId: '', centerId: '', funderId: '', fromDate: '', toDate: '',
    regionId: '', divisionId: '', areaId: '',
};

type ModalKind = 'group-loans' | 'center-loans' | 'collection' | 'overdue' | 'arrear-overdue' | 'zero-collection';
type ActiveModal = { kind: ModalKind; date: string; mode?: CollectionMode } | null;

// ── Data types ────────────────────────────────────────────────────────────────

export interface DemandCollectionRow {
    date: string;
    day: string;
    totalGroups: number;
    totalCenters: number;
    totalMembers: number;
    demandPrincipal: number;
    demandInterest: number;
    demandTotal: number;
    collectionGroups: number;
    collectionMembers: number;
    collectionDemand: number;
    collectionAdvance: number;
    collectionArrear: number;
    collectionPreclose: number;
    collectionTotal: number;
    yetToCollect: number;
    arrearDue: number;
    zeroCollectionMembers: number;
}

type ViewMode = 'group' | 'center';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
    try {
        return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(iso));
    } catch { return iso; }
}

function amt(n: number) {
    if (n === 0) return '—';
    if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;
}

function num(n: number) {
    return n === 0 ? '—' : new Intl.NumberFormat('en-IN').format(n);
}

// ── Pagination ────────────────────────────────────────────────────────────────

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
                <button disabled={page === 1} onClick={() => onPage(page - 1)}
                    className="rounded px-2 py-1 text-sidebar-accent hover:bg-brand-green-tint disabled:opacity-40 dark:text-slate-400 dark:hover:bg-sidebar-accent">← Prev</button>
                <span className="font-medium text-sidebar-accent dark:text-slate-300">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}
                    className="rounded px-2 py-1 text-sidebar-accent hover:bg-brand-green-tint disabled:opacity-40 dark:text-slate-400 dark:hover:bg-sidebar-accent">Next →</button>
            </div>
        </div>
    );
}

const thBase = 'border-b border-r border-primary/20 px-3 py-2 text-center font-medium dark:border-sidebar-accent';

function CollectionTh({ className, children }: { className: string; children: React.ReactNode }) {
    return <th className={cn(thBase, className)}>{children}</th>;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
    data?: DemandCollectionRow[];
    filters?: DashboardFilters;
    exportLabel?: string;
}

export function DemandCollectionTable({ data, filters, exportLabel }: Props) {
    const rows = data ?? [];
    const effectiveFilters = filters ?? EMPTY_FILTERS;

    const [viewMode, setViewMode] = useState<ViewMode>('group');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [activeModal, setActiveModal] = useState<ActiveModal>(null);

    useEffect(() => { setPage(1); }, [rows]);

    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const totals = rows.reduce(
        (acc, r) => ({
            totalGroups: acc.totalGroups + r.totalGroups,
            totalCenters: acc.totalCenters + (r.totalCenters ?? 0),
            totalMembers: acc.totalMembers + r.totalMembers,
            demandPrincipal: acc.demandPrincipal + r.demandPrincipal,
            demandInterest: acc.demandInterest + r.demandInterest,
            demandTotal: acc.demandTotal + r.demandTotal,
            collectionDemand: acc.collectionDemand + r.collectionDemand,
            collectionAdvance: acc.collectionAdvance + r.collectionAdvance,
            collectionArrear: acc.collectionArrear + r.collectionArrear,
            collectionPreclose: acc.collectionPreclose + r.collectionPreclose,
            collectionTotal: acc.collectionTotal + r.collectionTotal,
            yetToCollect: acc.yetToCollect + r.yetToCollect,
            arrearDue: acc.arrearDue + r.arrearDue,
            zeroCollectionMembers: acc.zeroCollectionMembers + r.zeroCollectionMembers,
        }),
        { totalGroups: 0, totalCenters: 0, totalMembers: 0, demandPrincipal: 0, demandInterest: 0, demandTotal: 0, collectionDemand: 0, collectionAdvance: 0, collectionArrear: 0, collectionPreclose: 0, collectionTotal: 0, yetToCollect: 0, arrearDue: 0, zeroCollectionMembers: 0 }
    );

    const today = new Date().toISOString().split('T')[0];

    const handleExportExcel = async () => {
        const XLSX = await import('xlsx');
        const label = exportLabel ?? new Date().toISOString().split('T')[0];
        const col3Label = viewMode === 'group' ? 'Total Groups' : 'Total Centers';
        const exportData = rows.map((r) => ({
            'Date': r.date,
            'Day': r.day,
            [col3Label]: viewMode === 'group' ? r.totalGroups : (r.totalCenters ?? 0),
            'Total Members': r.totalMembers,
            'Demand Principal': r.demandPrincipal,
            'Demand Interest': r.demandInterest,
            'Demand Total': r.demandTotal,
            'Coll Demand': r.collectionDemand,
            'Advance': r.collectionAdvance,
            'Arrear': r.collectionArrear,
            'Preclose': r.collectionPreclose,
            'Total Collection': r.collectionTotal,
            'Yet to Collect': r.yetToCollect,
            'Arrear Due': r.arrearDue,
            'Zero Coll Members': r.zeroCollectionMembers,
        }));
        if (rows.length > 0) {
            exportData.push({
                'Date': 'Total',
                'Day': '',
                [col3Label]: viewMode === 'group' ? totals.totalGroups : totals.totalCenters,
                'Total Members': totals.totalMembers,
                'Demand Principal': totals.demandPrincipal,
                'Demand Interest': totals.demandInterest,
                'Demand Total': totals.demandTotal,
                'Coll Demand': totals.collectionDemand,
                'Advance': totals.collectionAdvance,
                'Arrear': totals.collectionArrear,
                'Preclose': totals.collectionPreclose,
                'Total Collection': totals.collectionTotal,
                'Yet to Collect': totals.yetToCollect,
                'Arrear Due': totals.arrearDue,
                'Zero Coll Members': totals.zeroCollectionMembers,
            });
        }
        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Demand Collection');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `demand-collection-${viewMode}-${label}.xlsx`);
    };

    const col3Header = viewMode === 'group' ? 'Total Groups' : 'Total Centers';

    return (
        <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
            {/* Header */}
            <div className="bg-gradient-to-r from-primary via-brand-green-light to-sidebar-accent px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                            <BarChart3 className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Demand Collection Details</h3>
                            <p className="text-sm text-green-100">
                                {viewMode === 'group' ? 'Group-wise demand vs collection' : 'Center-wise demand vs collection'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* View toggle */}
                        <div className="flex overflow-hidden rounded-lg border border-white/30">
                            {(['group', 'center'] as ViewMode[]).map((v) => (
                                <button
                                    key={v}
                                    onClick={() => setViewMode(v)}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-semibold capitalize transition',
                                        viewMode === v
                                            ? 'bg-white text-sidebar-accent'
                                            : 'text-white hover:bg-white/20'
                                    )}
                                >
                                    {v}
                                </button>
                            ))}
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
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr className="bg-green-50 dark:bg-sidebar-accent/60">
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-left font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>Date</th>
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-left font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>Day</th>
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>{col3Header}</th>
                            <th className="border-b border-r border-primary/20 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400" rowSpan={2}>Total Members</th>
                            <th className="border-b border-r border-primary/20 bg-green-50 px-3 py-2.5 text-center font-semibold text-sidebar-accent dark:border-sidebar-accent dark:bg-green-950/20 dark:text-primary" colSpan={3}>Demand</th>
                            <th className="border-b border-primary/20 bg-emerald-50 px-3 py-2.5 text-center font-semibold text-emerald-700 dark:border-sidebar-accent dark:bg-emerald-950/20 dark:text-emerald-400" colSpan={8}>Collection</th>
                        </tr>
                        <tr className="bg-green-50 dark:bg-sidebar-accent/60">
                            <CollectionTh className="bg-green-50/70 text-primary dark:bg-green-950/10 dark:text-primary">Principal</CollectionTh>
                            <CollectionTh className="bg-green-50/70 text-primary dark:bg-green-950/10 dark:text-primary">Interest</CollectionTh>
                            <CollectionTh className="bg-green-50/70 text-primary dark:bg-green-950/10 dark:text-primary">Total</CollectionTh>
                            <CollectionTh className="bg-emerald-50/70 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400">Demand</CollectionTh>
                            <CollectionTh className="bg-emerald-50/70 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400">Advance</CollectionTh>
                            <CollectionTh className="bg-emerald-50/70 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400">Arrear</CollectionTh>
                            <CollectionTh className="bg-emerald-50/70 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400">Preclose</CollectionTh>
                            <CollectionTh className="bg-emerald-50/70 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400">Total</CollectionTh>
                            <CollectionTh className="bg-amber-50/70 text-amber-600 dark:bg-amber-950/10 dark:text-amber-400">Yet to Collect</CollectionTh>
                            <CollectionTh className="bg-rose-50/70 text-rose-600 dark:bg-rose-950/10 dark:text-rose-400">Arrear Due</CollectionTh>
                            <th className="border-b border-primary/20 bg-orange-50/70 px-3 py-2 text-center font-medium text-orange-600 dark:border-sidebar-accent dark:bg-orange-950/10 dark:text-orange-400">Zero Coll.</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={15} className="py-10 text-center text-slate-400 dark:text-sidebar-accent">
                                    No demand collection data for this period.
                                </td>
                            </tr>
                        ) : (
                            pageRows.map((row, i) => {
                                const isToday = row.date === today;
                                const isWeekend = row.day === 'Sunday' || row.day === 'Saturday';
                                const col3Val = viewMode === 'group' ? row.totalGroups : (row.totalCenters ?? 0);
                                return (
                                    <tr
                                        key={row.date}
                                        className={cn(
                                            'transition-colors hover:bg-green-50 dark:hover:bg-sidebar-accent/40',
                                            isToday && 'bg-green-50/60 dark:bg-green-950/20',
                                            !isToday && i % 2 !== 0 && 'bg-green-50/40 dark:bg-brand-green-darker/40',
                                            isWeekend && !isToday && 'opacity-60'
                                        )}
                                    >
                                        <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 font-medium text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">
                                            {fmtDate(row.date)}{isToday && <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-white">Today</span>}
                                        </td>
                                        <td className="border-r border-slate-100 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400">{row.day.substring(0, 3)}</td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 px-3 py-2.5 text-center font-medium text-sidebar-accent underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:text-slate-300"
                                            onClick={() =>
                                                setActiveModal({
                                                    kind: viewMode === 'group' ? 'group-loans' : 'center-loans',
                                                    date: row.date,
                                                })
                                            }
                                        >
                                            {num(col3Val)}
                                        </td>
                                        <td className="border-r border-slate-100 px-3 py-2.5 text-center font-medium text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{num(row.totalMembers)}</td>
                                        <td className="border-r border-slate-100 bg-green-50/30 px-3 py-2.5 text-right font-medium text-sidebar-accent dark:border-sidebar-accent dark:bg-green-950/10 dark:text-primary">{amt(row.demandPrincipal)}</td>
                                        <td className="border-r border-slate-100 bg-green-50/30 px-3 py-2.5 text-right text-primary dark:border-sidebar-accent dark:bg-green-950/10 dark:text-primary">{amt(row.demandInterest)}</td>
                                        <td className="border-r border-slate-100 bg-green-50/30 px-3 py-2.5 text-right font-semibold text-sidebar-accent dark:border-sidebar-accent dark:bg-green-950/10 dark:text-primary">{amt(row.demandTotal)}</td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 bg-emerald-50/30 px-3 py-2.5 text-right text-emerald-700 underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400"
                                            onClick={() => setActiveModal({ kind: 'collection', date: row.date, mode: 'Demand' })}
                                        >
                                            {amt(row.collectionDemand)}
                                        </td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 bg-emerald-50/30 px-3 py-2.5 text-right text-emerald-600 underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400"
                                            onClick={() => setActiveModal({ kind: 'collection', date: row.date, mode: 'Advance' })}
                                        >
                                            {amt(row.collectionAdvance)}
                                        </td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 bg-emerald-50/30 px-3 py-2.5 text-right text-emerald-600 underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400"
                                            onClick={() => setActiveModal({ kind: 'collection', date: row.date, mode: 'Arrear' })}
                                        >
                                            {amt(row.collectionArrear)}
                                        </td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 bg-emerald-50/30 px-3 py-2.5 text-right text-emerald-600 underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400"
                                            onClick={() => setActiveModal({ kind: 'collection', date: row.date, mode: 'Preclose' })}
                                        >
                                            {amt(row.collectionPreclose)}
                                        </td>
                                        <td className="border-r border-slate-100 bg-emerald-50/30 px-3 py-2.5 text-right font-semibold text-emerald-700 dark:border-sidebar-accent dark:bg-emerald-950/10 dark:text-emerald-400">{amt(row.collectionTotal)}</td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 bg-amber-50/30 px-3 py-2.5 text-right text-amber-700 underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:bg-amber-950/10 dark:text-amber-400"
                                            onClick={() => setActiveModal({ kind: 'overdue', date: row.date })}
                                        >
                                            {amt(row.yetToCollect)}
                                        </td>
                                        <td
                                            className="cursor-pointer border-r border-slate-100 bg-rose-50/30 px-3 py-2.5 text-right text-rose-600 underline decoration-dotted hover:opacity-75 dark:border-sidebar-accent dark:bg-rose-950/10 dark:text-rose-400"
                                            onClick={() => setActiveModal({ kind: 'arrear-overdue', date: row.date })}
                                        >
                                            {amt(row.arrearDue)}
                                        </td>
                                        <td
                                            className="cursor-pointer bg-orange-50/30 px-3 py-2.5 text-center text-orange-700 underline decoration-dotted hover:opacity-75 dark:bg-orange-950/10 dark:text-orange-400"
                                            onClick={() => setActiveModal({ kind: 'zero-collection', date: row.date })}
                                        >
                                            {num(row.zeroCollectionMembers)}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t-2 border-primary/30 bg-brand-green-tint font-semibold dark:border-sidebar-accent/60 dark:bg-sidebar-accent">
                                <td colSpan={2} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">Total</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-center text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">
                                    {num(viewMode === 'group' ? totals.totalGroups : totals.totalCenters)}
                                </td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-center text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{num(totals.totalMembers)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-primary">{amt(totals.demandPrincipal)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-primary">{amt(totals.demandInterest)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-primary">{amt(totals.demandTotal)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{amt(totals.collectionDemand)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{amt(totals.collectionAdvance)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{amt(totals.collectionArrear)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{amt(totals.collectionPreclose)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-emerald-700 dark:border-sidebar-accent dark:text-emerald-400">{amt(totals.collectionTotal)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-amber-700 dark:border-sidebar-accent dark:text-amber-400">{amt(totals.yetToCollect)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-rose-700 dark:border-sidebar-accent dark:text-rose-400">{amt(totals.arrearDue)}</td>
                                <td className="px-3 py-2.5 text-center text-orange-700 dark:text-orange-400">{num(totals.zeroCollectionMembers)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* Pagination */}
            {rows.length > 0 && (
                <PaginationBar
                    page={page}
                    pageSize={pageSize}
                    total={rows.length}
                    onPage={setPage}
                    onPageSize={(s) => { setPageSize(s); setPage(1); }}
                />
            )}

            {activeModal?.kind === 'group-loans' && (
                <GroupLoanDetailsModal
                    open
                    onOpenChange={(o) => !o && setActiveModal(null)}
                    date={activeModal.date}
                    filters={effectiveFilters}
                />
            )}
            {activeModal?.kind === 'center-loans' && (
                <CenterLoanDetailsModal
                    open
                    onOpenChange={(o) => !o && setActiveModal(null)}
                    date={activeModal.date}
                    filters={effectiveFilters}
                />
            )}
            {activeModal?.kind === 'collection' && activeModal.mode && (
                <CollectionDetailsModal
                    open
                    onOpenChange={(o) => !o && setActiveModal(null)}
                    date={activeModal.date}
                    mode={activeModal.mode}
                    filters={effectiveFilters}
                />
            )}
            {activeModal?.kind === 'overdue' && (
                <OverdueModal
                    open
                    onOpenChange={(o) => !o && setActiveModal(null)}
                    date={activeModal.date}
                    filters={effectiveFilters}
                />
            )}
            {activeModal?.kind === 'arrear-overdue' && (
                <ArrearOverdueModal
                    open
                    onOpenChange={(o) => !o && setActiveModal(null)}
                    date={activeModal.date}
                    filters={effectiveFilters}
                />
            )}
            {activeModal?.kind === 'zero-collection' && (
                <ZeroCollectionDetailsModal
                    open
                    onOpenChange={(o) => !o && setActiveModal(null)}
                    date={activeModal.date}
                    filters={effectiveFilters}
                />
            )}
        </div>
    );
}
