'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import type { DashboardFilters } from '@/components/dashboard/v2/DashboardFiltersBar';
import { DrillDownModal } from './DrillDownModal';
import { DrillDownTable, DrillDownColumn } from './DrillDownTable';

export interface OverdueRow {
    memberId: string;
    memberName: string;
    memberPhone: string;
    branchName: string;
    centerName: string;
    groupName: string;
    officerName: string;
    officerPhone: string;
    principal: number;
    interest: number;
    total: number;
    status: string;
}

function fmtAmount(n: number) {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
}
function fmtDdMmYyyy(ymd: string) {
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    date: string;
    filters: DashboardFilters;
}

export function OverdueModal({ open, onOpenChange, date, filters }: Props) {
    const [rows, setRows] = useState<OverdueRow[]>([]);
    const [totals, setTotals] = useState({ principal: 0, interest: 0, total: 0 });
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        Promise.resolve().then(() => { if (!cancelled) setIsLoading(true); });
        const params = new URLSearchParams({ modal: 'overdue', date });
        if (filters.branchId) params.set('branchId', filters.branchId);
        if (filters.centerId) params.set('centerId', filters.centerId);
        if (filters.regionId) params.set('regionId', filters.regionId);
        if (filters.divisionId) params.set('divisionId', filters.divisionId);
        if (filters.areaId) params.set('areaId', filters.areaId);

        apiClient
            .get<{ rows: OverdueRow[]; totals: { principal: number; interest: number; total: number } }>(
                `/dashboard/v2/demand-drilldown?${params.toString()}`
            )
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) {
                    setRows(res.data.rows);
                    setTotals(res.data.totals);
                }
            })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [open, date, filters.branchId, filters.centerId, filters.regionId, filters.divisionId, filters.areaId]);

    const columns: DrillDownColumn<OverdueRow>[] = [
        { key: 'memberId', label: 'Member ID' },
        { key: 'memberName', label: 'Member Name' },
        { key: 'memberPhone', label: 'Phone' },
        { key: 'branchName', label: 'Branch' },
        { key: 'centerName', label: 'Center' },
        { key: 'groupName', label: 'Group' },
        { key: 'officerName', label: 'Officer' },
        { key: 'officerPhone', label: 'Officer Phone' },
        { key: 'principal', label: 'Principal', align: 'right', render: (r) => fmtAmount(r.principal), footerValue: (rows) => rows.reduce((s, r) => s + r.principal, 0) },
        { key: 'interest', label: 'Interest', align: 'right', render: (r) => fmtAmount(r.interest), footerValue: (rows) => rows.reduce((s, r) => s + r.interest, 0) },
        { key: 'total', label: 'Total', align: 'right', render: (r) => fmtAmount(r.total), footerValue: (rows) => rows.reduce((s, r) => s + r.total, 0) },
        { key: 'status', label: 'Status', align: 'center', render: (r) => (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{r.status}</span>
        ) },
    ];

    return (
        <DrillDownModal
            open={open}
            onOpenChange={onOpenChange}
            title="Overdue"
            subtitle={`Total Overdue · Date : ${fmtDdMmYyyy(date)}`}
            headerStats={[
                { label: 'Total Overdue', value: fmtAmount(totals.total) },
                { label: 'Principal Overdue', value: fmtAmount(totals.principal) },
                { label: 'Interest Overdue', value: fmtAmount(totals.interest) },
            ]}
        >
            <DrillDownTable
                columns={columns}
                rows={rows}
                isLoading={isLoading}
                searchPlaceholder="Search member, branch, center, group, officer..."
                exportFileName={`overdue-${date}`}
                exportSheetName="Overdue"
                footer={(filteredRows) => {
                    const t = filteredRows.reduce(
                        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.total }),
                        { principal: 0, interest: 0, total: 0 }
                    );
                    return (
                        <tr>
                            <td colSpan={8} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">Total</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.principal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.interest)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.total)}</td>
                            <td className="px-3 py-2.5" />
                        </tr>
                    );
                }}
            />
        </DrillDownModal>
    );
}
