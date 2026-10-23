'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import type { DashboardFilters } from '@/components/dashboard/v2/DashboardFiltersBar';
import { DrillDownModal } from './DrillDownModal';
import { DrillDownTable, DrillDownColumn } from './DrillDownTable';

export type CollectionMode = 'Demand' | 'Advance' | 'Arrear' | 'Preclose';

export interface CollectionRow {
    memberId: string;
    memberName: string;
    memberPhone: string;
    dueNo: number | string;
    dueDate: string;
    paidDate: string;
    principal: number;
    interest: number;
    emi: number;
    totalAmount: number;
    collectionMode: CollectionMode;
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
    mode: CollectionMode;
    filters: DashboardFilters;
}

export function CollectionDetailsModal({ open, onOpenChange, date, mode, filters }: Props) {
    const [rows, setRows] = useState<CollectionRow[]>([]);
    const [totals, setTotals] = useState({ principal: 0, interest: 0, total: 0 });
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        Promise.resolve().then(() => { if (!cancelled) setIsLoading(true); });
        const params = new URLSearchParams({ modal: 'collection', date, mode });
        if (filters.branchId) params.set('branchId', filters.branchId);
        if (filters.centerId) params.set('centerId', filters.centerId);
        if (filters.regionId) params.set('regionId', filters.regionId);
        if (filters.divisionId) params.set('divisionId', filters.divisionId);
        if (filters.areaId) params.set('areaId', filters.areaId);

        apiClient
            .get<{ rows: CollectionRow[]; totals: { principal: number; interest: number; total: number } }>(
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
    }, [open, date, mode, filters.branchId, filters.centerId, filters.regionId, filters.divisionId, filters.areaId]);

    const columns: DrillDownColumn<CollectionRow>[] = [
        { key: 'memberId', label: 'Member ID' },
        { key: 'memberName', label: 'Member Name' },
        { key: 'memberPhone', label: 'Member Phone Number' },
        { key: 'dueNo', label: 'Due #', align: 'center' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'paidDate', label: 'Paid Date' },
        { key: 'principal', label: 'Principal', align: 'right', render: (r) => fmtAmount(r.principal), footerValue: (rows) => rows.reduce((s, r) => s + r.principal, 0) },
        { key: 'interest', label: 'Interest', align: 'right', render: (r) => fmtAmount(r.interest), footerValue: (rows) => rows.reduce((s, r) => s + r.interest, 0) },
        { key: 'emi', label: 'EMI', align: 'right', render: (r) => fmtAmount(r.emi) },
        { key: 'totalAmount', label: 'Total Amount', align: 'right', render: (r) => fmtAmount(r.totalAmount), footerValue: (rows) => rows.reduce((s, r) => s + r.totalAmount, 0) },
        { key: 'collectionMode', label: 'Collection Mode', align: 'center' },
    ];

    return (
        <DrillDownModal
            open={open}
            onOpenChange={onOpenChange}
            title="Today Collection Details"
            subtitle={`${mode} Collection · Date : ${fmtDdMmYyyy(date)}`}
            headerStats={[
                { label: 'Total Collection', value: fmtAmount(totals.total) },
                { label: 'Collection Principal', value: fmtAmount(totals.principal) },
                { label: 'Collection Interest', value: fmtAmount(totals.interest) },
            ]}
        >
            <DrillDownTable
                columns={columns}
                rows={rows}
                isLoading={isLoading}
                searchPlaceholder="Search member name, ID, phone..."
                exportFileName={`${mode.toLowerCase()}-collection-details-${date}`}
                exportSheetName="Collection Details"
                footer={(filteredRows) => {
                    const t = filteredRows.reduce(
                        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.totalAmount }),
                        { principal: 0, interest: 0, total: 0 }
                    );
                    return (
                        <tr>
                            <td colSpan={6} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">Total</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.principal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.interest)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5" />
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.total)}</td>
                            <td className="px-3 py-2.5" />
                        </tr>
                    );
                }}
            />
        </DrillDownModal>
    );
}
