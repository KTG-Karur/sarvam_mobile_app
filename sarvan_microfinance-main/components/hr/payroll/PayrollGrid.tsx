'use client';

import React, { memo, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeGridRow, type GridEdits, type GridEditKey, type GridRowComputed } from '@/app/lib/payroll/payroll-grid';
import type { BulkGridRow } from '@/app/lib/payroll/bulk-grid-types';
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Bulk Payroll grid — mirrors the org's "Payroll" excel sheet column for
 * column (S.No … Net Pay). Every figure is recomputed live from the row's
 * server baseline + the user's edits via the shared computeGridRow formulas,
 * so changing Days / LOP / CTC re-flows Gross → Basic/HRA → PF/ESI → totals →
 * Net Pay exactly like the sheet. Any numeric cell can be overwritten
 * (amber = manually edited; clear the cell to go back to the computed value).
 * Yellow-tinted columns are the sheet's formula columns.
 */

type Props = {
    rows: BulkGridRow[];
    edits: Record<string, GridEdits>;
    selected: Set<string>;
    disabled?: boolean;
    onEdit: (employeeId: string, key: GridEditKey | 'workingDays', value: number | null) => void;
    onResetRow: (employeeId: string) => void;
    onToggleRow: (employeeId: string, checked: boolean) => void;
    onToggleAll: (checked: boolean) => void;
};

type ComponentColumn = { id: string; name: string; type: 'EARNINGS' | 'DEDUCTIONS'; salaryId: number; systemBacked: boolean };

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const money = (n: number): string => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
const fmtDate = (iso: string | null): string =>
    iso ? toDisplayDate(new Date(iso)) : '—';

const YELLOW = 'bg-yellow-50 dark:bg-yellow-900/10';
const EDITED = 'bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-400';

/** One editable number cell. Keeps its own text draft while focused so
 * typing "12." or clearing the box doesn't fight the recomputed value. */
const NumCell = memo(function NumCell({
    value, edited, formula, disabled, warn, onCommit, title,
}: {
    value: number; edited: boolean; formula?: boolean; disabled?: boolean; warn?: boolean;
    onCommit: (v: number | null) => void; title?: string;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            type="text"
            inputMode="decimal"
            title={title}
            disabled={disabled}
            value={draft ?? fmt(value)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
                const raw = e.target.value;
                setDraft(raw);
                if (raw.trim() === '') return onCommit(null);
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 0) onCommit(n);
            }}
            onBlur={() => setDraft(null)}
            className={cn(
                'h-7 w-[88px] rounded border border-transparent px-1.5 text-right text-xs tabular-nums outline-none',
                'focus:border-primary focus:bg-white dark:focus:bg-sidebar-accent',
                formula && !edited && YELLOW,
                edited && EDITED,
                warn && 'ring-1 ring-red-400',
                disabled && 'cursor-not-allowed opacity-60',
            )}
        />
    );
});

const Text = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <td className={cn('whitespace-nowrap px-2 py-1 text-xs', className)}>{children}</td>
);

const ReadNum = ({ value, className }: { value: number; className?: string }) => (
    <td className={cn('whitespace-nowrap px-2 py-1 text-right text-xs font-semibold tabular-nums', YELLOW, className)}>{money(value)}</td>
);

type RowViewProps = {
    index: number;
    row: BulkGridRow;
    edits: GridEdits | undefined;
    checked: boolean;
    disabled?: boolean;
    earningCols: ComponentColumn[];
    deductionCols: ComponentColumn[];
    onEdit: Props['onEdit'];
    onResetRow: Props['onResetRow'];
    onToggleRow: Props['onToggleRow'];
};

const RowView = memo(function RowView({ index, row, edits, checked, disabled, earningCols, deductionCols, onEdit, onResetRow, onToggleRow }: RowViewProps) {
    const g: GridRowComputed | null = useMemo(() => (row.base ? computeGridRow(row.base, edits) : null), [row.base, edits]);
    const locked = disabled || !row.willRun;
    const edit = (key: GridEditKey | 'workingDays') => (v: number | null) => onEdit(row.employeeId, key, v);
    const isEdited = (key: keyof GridEdits) => edits?.[key] !== undefined;
    const compEdited = (id: string) => edits?.components?.[id] !== undefined;
    const compMeta = (id: string) => row.base?.components.find((c) => c.id === id);
    const hasEdits = !!edits && Object.keys(edits).length > 0;

    const stickyBg = row.willRun ? 'bg-white dark:bg-brand-green-darker' : 'bg-slate-50 dark:bg-slate-900';

    return (
        <tr className={cn('border-b border-primary/10 dark:border-sidebar-accent', !row.willRun && 'opacity-60')}>
            <td className={cn('sticky left-0 z-10 w-[64px] min-w-[64px] whitespace-nowrap px-2 py-1 text-xs', stickyBg)}>
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(e) => onToggleRow(row.employeeId, e.target.checked)}
                    className="mr-2 align-middle"
                    aria-label={`Select ${row.employeeName}`}
                />
                {index + 1}
            </td>
            <td className={cn('sticky left-[64px] z-10 whitespace-nowrap px-2 py-1 text-xs font-medium shadow-[2px_0_0_0_rgba(0,0,0,0.06)]', stickyBg)}>{row.employeeName}</td>
            <Text>{row.employeeCode || '—'}</Text>
            <Text>
                <span className={row.status === 'Live' ? 'text-green-700 dark:text-green-400' : 'text-red-600'}>{row.status}</span>
            </Text>
            <Text>{fmtDate(row.dateOfJoining)}</Text>
            <Text>{row.region ?? '—'}</Text>
            <Text>{row.division ?? '—'}</Text>
            <Text>{row.area ?? '—'}</Text>
            <Text>{row.branchCode ?? '—'}</Text>
            <Text>{row.branchName ?? '—'}</Text>
            <Text>{row.designation ?? '—'}</Text>
            <Text>{row.department ?? '—'}</Text>

            {!g ? (
                <td colSpan={14 + earningCols.length + deductionCols.length} className="px-2 py-1 text-xs text-slate-500">
                    {row.reason ?? 'No payroll data'}
                </td>
            ) : (
                <>
                    <td className="px-1 py-1"><NumCell value={g.totalPaidDays} edited={isEdited('totalPaidDays')} disabled={locked} onCommit={edit('totalPaidDays')} title="Total Paid Days" /></td>
                    <td className="px-1 py-1"><NumCell value={g.lopDays} edited={isEdited('lopDays')} disabled={locked} onCommit={edit('lopDays')} title={row.lopNote ? `LOP — ${row.lopNote}` : 'LOP'} /></td>
                    <td className="px-1 py-1"><NumCell value={g.monthlyCtc} edited={isEdited('monthlyCtc')} disabled={locked} warn={g.monthlyCtc <= 0} onCommit={edit('monthlyCtc')} title="Month CTC Pay" /></td>
                    <td className="px-1 py-1"><NumCell value={g.basic} edited={isEdited('basic')} formula disabled={locked} onCommit={edit('basic')} title="Basic" /></td>
                    <td className="px-1 py-1"><NumCell value={g.hra} edited={isEdited('hra')} formula disabled={locked} onCommit={edit('hra')} title="HRA" /></td>
                    <td className="px-1 py-1"><NumCell value={g.proratedCtc} edited={isEdited('proratedCtc')} formula disabled={locked} onCommit={edit('proratedCtc')} title="Month CTC Pay (prorated)" /></td>
                    <td className="px-1 py-1"><NumCell value={g.workingDays} edited={isEdited('lopDays')} formula disabled={locked} onCommit={edit('workingDays')} title="Working days (Total Paid Days − LOP)" /></td>
                    <td className="px-1 py-1"><NumCell value={g.actualBasic} edited={isEdited('actualBasic')} formula disabled={locked} onCommit={edit('actualBasic')} title="Actual Basic" /></td>
                    <td className="px-1 py-1"><NumCell value={g.actualHra} edited={isEdited('actualHra')} formula disabled={locked} onCommit={edit('actualHra')} title="Actual HRA" /></td>
                    <td className="px-1 py-1"><NumCell value={g.actualGross} edited={isEdited('actualGross')} formula disabled={locked} onCommit={edit('actualGross')} title="Actual Gross" /></td>

                    {earningCols.map((c) => {
                        const meta = compMeta(c.id);
                        return (
                            <td key={c.id} className="px-1 py-1">
                                {meta ? (
                                    <NumCell value={g.amounts[c.id] ?? 0} edited={compEdited(c.id)} disabled={locked} onCommit={edit(`c:${c.id}`)} title={c.name} />
                                ) : <span className="px-2 text-xs text-slate-400">—</span>}
                            </td>
                        );
                    })}
                    <ReadNum value={g.totalEarnings} />

                    {deductionCols.map((c) => {
                        const meta = compMeta(c.id);
                        const overridden = compEdited(c.id) && c.systemBacked && meta && edits?.components?.[c.id] !== meta.amount;
                        return (
                            <td key={c.id} className="px-1 py-1">
                                {meta ? (
                                    <NumCell
                                        value={g.amounts[c.id] ?? 0}
                                        edited={compEdited(c.id)}
                                        formula={meta.kind === 'PERCENT'}
                                        disabled={locked}
                                        warn={!!overridden}
                                        onCommit={edit(`c:${c.id}`)}
                                        title={overridden
                                            ? `${c.name}: edited — its module schedule still posts the original installment (${money(meta.amount)})`
                                            : c.name}
                                    />
                                ) : <span className="px-2 text-xs text-slate-400">—</span>}
                            </td>
                        );
                    })}
                    <ReadNum value={g.totalDeductions} />
                    <ReadNum value={g.netWithIncentive} />
                    <ReadNum value={g.netPay} className={g.netPay < 0 ? 'text-red-600' : 'text-primary'} />
                </>
            )}
            <td className="px-2 py-1 text-xs">
                {hasEdits && (
                    <button
                        type="button"
                        onClick={() => onResetRow(row.employeeId)}
                        disabled={locked}
                        className="inline-flex items-center gap-1 text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400"
                        title="Discard this row's edits"
                    >
                        <RotateCcw className="h-3 w-3" /> Reset
                    </button>
                )}
            </td>
            <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{row.reason ?? ''}</td>
        </tr>
    );
});

export function PayrollGrid({ rows, edits, selected, disabled, onEdit, onResetRow, onToggleRow, onToggleAll }: Props) {
    // Component columns are the union across rows (ordered by Salary Id), minus
    // Basic/HRA which the sheet shows as Actual Basic / Actual HRA.
    const { earningCols, deductionCols } = useMemo(() => {
        const byId = new Map<string, ComponentColumn>();
        for (const r of rows) {
            for (const c of r.base?.components ?? []) {
                if (c.kind === 'BASIC' || c.kind === 'HRA') continue;
                if (!byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name, type: c.type, salaryId: c.salaryId, systemBacked: !!c.systemBacked });
            }
        }
        const all = [...byId.values()].sort((a, b) => a.salaryId - b.salaryId);
        return { earningCols: all.filter((c) => c.type === 'EARNINGS'), deductionCols: all.filter((c) => c.type === 'DEDUCTIONS') };
    }, [rows]);

    const runnable = useMemo(() => rows.filter((r) => r.willRun), [rows]);
    const allChecked = runnable.length > 0 && runnable.every((r) => selected.has(r.employeeId));

    // Column totals over the selected rows (the ones a Run would pay).
    const totals = useMemo(() => {
        const t = { earnings: 0, deductions: 0, netWith: 0, netPay: 0, count: 0 };
        for (const r of rows) {
            if (!r.base || !selected.has(r.employeeId)) continue;
            const g = computeGridRow(r.base, edits[r.employeeId]);
            t.earnings += g.totalEarnings; t.deductions += g.totalDeductions; t.netWith += g.netWithIncentive; t.netPay += g.netPay; t.count += 1;
        }
        return t;
    }, [rows, edits, selected]);

    const th = 'whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white';

    return (
        <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-primary/10 px-4 py-2 text-xs text-slate-600 dark:border-sidebar-accent dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5"><span className={cn('h-3 w-3 rounded-sm border', YELLOW)} /> Formula cell (auto-calculated — you can still overwrite it)</span>
                <span className="inline-flex items-center gap-1.5"><span className={cn('h-3 w-3 rounded-sm', EDITED)} /> Manually edited (clear the cell to restore the computed value)</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm ring-1 ring-red-400" /> Needs attention</span>
            </div>
            <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-20">
                        <tr>
                            <th className={cn(th, 'sticky left-0 z-30 w-[64px] min-w-[64px] bg-slate-700')}>
                                <input type="checkbox" className="mr-2 align-middle" checked={allChecked} disabled={disabled || runnable.length === 0} onChange={(e) => onToggleAll(e.target.checked)} aria-label="Select all" />
                                S.No
                            </th>
                            <th className={cn(th, 'sticky left-[64px] z-30 bg-slate-700')}>Emp Name</th>
                            {['Emp ID', 'Status', 'Date of Joining', 'Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Designation', 'Department'].map((h) => (
                                <th key={h} className={cn(th, 'bg-slate-700')}>{h}</th>
                            ))}
                            {['Total Paid Days', 'LOP', 'Month CTC Pay', 'Basic', 'HRA', 'Month CTC Pay', 'Working days', 'Actual Basic', 'Actual HRA', 'Actual Gross'].map((h, i) => (
                                <th key={`${h}-${i}`} className={cn(th, 'bg-indigo-700')}>{h}</th>
                            ))}
                            {earningCols.map((c) => <th key={c.id} className={cn(th, 'bg-emerald-700')}>{c.name}</th>)}
                            <th className={cn(th, 'bg-emerald-800')}>Total Earnings</th>
                            {deductionCols.map((c) => <th key={c.id} className={cn(th, 'bg-rose-700')}>{c.name}</th>)}
                            <th className={cn(th, 'bg-rose-800')}>Total Deduction</th>
                            <th className={cn(th, 'bg-blue-700')}>Net Salary With Incentive</th>
                            <th className={cn(th, 'bg-blue-800')}>Net Pay</th>
                            <th className={cn(th, 'bg-slate-700')} />
                            <th className={cn(th, 'bg-slate-700')}>Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <RowView
                                key={r.employeeId}
                                index={i}
                                row={r}
                                edits={edits[r.employeeId]}
                                checked={selected.has(r.employeeId)}
                                disabled={disabled}
                                earningCols={earningCols}
                                deductionCols={deductionCols}
                                onEdit={onEdit}
                                onResetRow={onResetRow}
                                onToggleRow={onToggleRow}
                            />
                        ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20">
                        <tr className="bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                            <td colSpan={2} className="sticky left-0 z-30 whitespace-nowrap bg-slate-100 px-2 py-2 dark:bg-slate-800">Selected total ({totals.count})</td>
                            <td colSpan={20 + earningCols.length} />
                            <td className="px-2 py-2 text-right tabular-nums" title="Total Earnings">{money(totals.earnings)}</td>
                            {deductionCols.length > 0 && <td colSpan={deductionCols.length} />}
                            <td className="px-2 py-2 text-right tabular-nums" title="Total Deduction">{money(totals.deductions)}</td>
                            <td className="px-2 py-2 text-right tabular-nums" title="Net Salary With Incentive">{money(totals.netWith)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-primary" title="Net Pay">{money(totals.netPay)}</td>
                            <td colSpan={2} />
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
