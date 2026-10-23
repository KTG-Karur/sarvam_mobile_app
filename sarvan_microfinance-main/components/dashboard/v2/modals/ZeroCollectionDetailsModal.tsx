'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import type { DashboardFilters } from '@/components/dashboard/v2/DashboardFiltersBar';
import { DrillDownModal } from './DrillDownModal';
import { DrillDownTable, DrillDownColumn } from './DrillDownTable';

export interface ZeroCollectionRow {
    sNo: number;
    memberId: string;
    memberName: string;
    memberPhone: string;
    branchName: string;
    centerName: string;
    duePrincipal: number;
    dueInterest: number;
    dueTotal: number;
    arrearPrincipal: number;
    arrearInterest: number;
    arrearTotal: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingTotal: number;
    collectedDate: string;
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

export function ZeroCollectionDetailsModal({ open, onOpenChange, date, filters }: Props) {
    const [rows, setRows] = useState<ZeroCollectionRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        Promise.resolve().then(() => { if (!cancelled) setIsLoading(true); });
        const params = new URLSearchParams({ modal: 'zero-collection', date });
        if (filters.branchId) params.set('branchId', filters.branchId);
        if (filters.centerId) params.set('centerId', filters.centerId);
        if (filters.regionId) params.set('regionId', filters.regionId);
        if (filters.divisionId) params.set('divisionId', filters.divisionId);
        if (filters.areaId) params.set('areaId', filters.areaId);

        apiClient
            .get<{ rows: ZeroCollectionRow[] }>(`/dashboard/v2/demand-drilldown?${params.toString()}`)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) setRows(res.data.rows);
            })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [open, date, filters.branchId, filters.centerId, filters.regionId, filters.divisionId, filters.areaId]);

    const columns: DrillDownColumn<ZeroCollectionRow>[] = [
        { key: 'sNo', label: 'S.No', align: 'center', sortable: false },
        { key: 'memberId', label: 'Member ID' },
        { key: 'memberName', label: 'Member Name' },
        { key: 'memberPhone', label: 'Phone' },
        { key: 'branchName', label: 'Branch' },
        { key: 'centerName', label: 'Center' },
        { key: 'duePrincipal', label: 'Due Principal', align: 'right', render: (r) => fmtAmount(r.duePrincipal), footerValue: (rows) => rows.reduce((s, r) => s + r.duePrincipal, 0) },
        { key: 'dueInterest', label: 'Due Interest', align: 'right', render: (r) => fmtAmount(r.dueInterest), footerValue: (rows) => rows.reduce((s, r) => s + r.dueInterest, 0) },
        { key: 'dueTotal', label: 'Due Total', align: 'right', render: (r) => fmtAmount(r.dueTotal), footerValue: (rows) => rows.reduce((s, r) => s + r.dueTotal, 0) },
        { key: 'arrearPrincipal', label: 'Arrear Principal', align: 'right', render: (r) => fmtAmount(r.arrearPrincipal), footerValue: (rows) => rows.reduce((s, r) => s + r.arrearPrincipal, 0) },
        { key: 'arrearInterest', label: 'Arrear Interest', align: 'right', render: (r) => fmtAmount(r.arrearInterest), footerValue: (rows) => rows.reduce((s, r) => s + r.arrearInterest, 0) },
        { key: 'arrearTotal', label: 'Arrear Total', align: 'right', render: (r) => fmtAmount(r.arrearTotal), footerValue: (rows) => rows.reduce((s, r) => s + r.arrearTotal, 0) },
        { key: 'outstandingPrincipal', label: 'Outstanding Principal', align: 'right', render: (r) => fmtAmount(r.outstandingPrincipal), footerValue: (rows) => rows.reduce((s, r) => s + r.outstandingPrincipal, 0) },
        { key: 'outstandingInterest', label: 'Outstanding Interest', align: 'right', render: (r) => fmtAmount(r.outstandingInterest), footerValue: (rows) => rows.reduce((s, r) => s + r.outstandingInterest, 0) },
        { key: 'outstandingTotal', label: 'Outstanding Total', align: 'right', render: (r) => fmtAmount(r.outstandingTotal), footerValue: (rows) => rows.reduce((s, r) => s + r.outstandingTotal, 0) },
        { key: 'collectedDate', label: 'Collected Date', align: 'center' },
    ];

    return (
        <DrillDownModal
            open={open}
            onOpenChange={onOpenChange}
            title="Zero Collection Details"
            subtitle={`Demand Date : ${fmtDdMmYyyy(date)}`}
        >
            <DrillDownTable
                columns={columns}
                rows={rows}
                isLoading={isLoading}
                searchPlaceholder="Search member, branch, center..."
                exportFileName={`zero-collection-details-${date}`}
                exportSheetName="Zero Collection"
                footer={(filteredRows) => {
                    const t = filteredRows.reduce(
                        (acc, r) => ({
                            duePrincipal: acc.duePrincipal + r.duePrincipal,
                            dueInterest: acc.dueInterest + r.dueInterest,
                            dueTotal: acc.dueTotal + r.dueTotal,
                            arrearPrincipal: acc.arrearPrincipal + r.arrearPrincipal,
                            arrearInterest: acc.arrearInterest + r.arrearInterest,
                            arrearTotal: acc.arrearTotal + r.arrearTotal,
                            outstandingPrincipal: acc.outstandingPrincipal + r.outstandingPrincipal,
                            outstandingInterest: acc.outstandingInterest + r.outstandingInterest,
                            outstandingTotal: acc.outstandingTotal + r.outstandingTotal,
                        }),
                        {
                            duePrincipal: 0, dueInterest: 0, dueTotal: 0,
                            arrearPrincipal: 0, arrearInterest: 0, arrearTotal: 0,
                            outstandingPrincipal: 0, outstandingInterest: 0, outstandingTotal: 0,
                        }
                    );
                    return (
                        <tr>
                            <td colSpan={6} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">Total</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.duePrincipal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.dueInterest)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.dueTotal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.arrearPrincipal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.arrearInterest)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.arrearTotal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.outstandingPrincipal)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.outstandingInterest)}</td>
                            <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.outstandingTotal)}</td>
                            <td className="px-3 py-2.5" />
                        </tr>
                    );
                }}
            />
        </DrillDownModal>
    );
}
