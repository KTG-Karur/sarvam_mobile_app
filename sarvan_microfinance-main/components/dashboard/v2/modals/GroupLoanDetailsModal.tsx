'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import type { DashboardFilters } from '@/components/dashboard/v2/DashboardFiltersBar';
import { DrillDownModal } from './DrillDownModal';
import { DrillDownTable, DrillDownColumn } from './DrillDownTable';
import { GroupMemberDetailsModal } from './GroupMemberDetailsModal';

export interface GroupLoanRow {
    groupId: string;
    branchName: string;
    centerName: string;
    groupName: string;
    officerName: string;
    officerPhone: string;
    meetupTime: string;
    collectionTime: string;
    dueCount: string;
    collectedMembers: number;
    totalMembers: number;
    demandPrincipal: number;
    demandInterest: number;
    demandTotal: number;
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

export function GroupLoanDetailsModal({ open, onOpenChange, date, filters }: Props) {
    const [rows, setRows] = useState<GroupLoanRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState<{ groupId: string; groupName: string } | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        Promise.resolve().then(() => { if (!cancelled) setIsLoading(true); });
        const params = new URLSearchParams({ modal: 'group-loans', date });
        if (filters.branchId) params.set('branchId', filters.branchId);
        if (filters.centerId) params.set('centerId', filters.centerId);
        if (filters.regionId) params.set('regionId', filters.regionId);
        if (filters.divisionId) params.set('divisionId', filters.divisionId);
        if (filters.areaId) params.set('areaId', filters.areaId);

        apiClient
            .get<{ rows: GroupLoanRow[] }>(`/dashboard/v2/demand-drilldown?${params.toString()}`)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) {
                    setRows(res.data.rows);
                }
            })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [open, date, filters.branchId, filters.centerId, filters.regionId, filters.divisionId, filters.areaId]);

    const columns: DrillDownColumn<GroupLoanRow>[] = [
        { key: 'branchName', label: 'Branch Name' },
        { key: 'centerName', label: 'Center Name' },
        { key: 'groupName', label: 'Group Name' },
        { key: 'officerName', label: 'Group Officer' },
        { key: 'officerPhone', label: 'Officer Phone Number' },
        { key: 'meetupTime', label: 'MeetUp Time' },
        { key: 'collectionTime', label: 'Collection Time' },
        { key: 'dueCount', label: '# Due Count', sortable: false },
        {
            key: 'present',
            label: 'Present Count / # Members',
            align: 'center',
            sortable: false,
            value: (r) => `${r.collectedMembers}/${r.totalMembers}`,
            render: (r) => (
                <button
                    type="button"
                    onClick={() => setSelectedGroup({ groupId: r.groupId, groupName: r.groupName })}
                    className="font-semibold text-primary underline decoration-dotted hover:text-sidebar-accent dark:text-primary"
                >
                    {r.collectedMembers}/{r.totalMembers}
                </button>
            ),
            footerValue: (rows) => `${rows.reduce((s, r) => s + r.collectedMembers, 0)}/${rows.reduce((s, r) => s + r.totalMembers, 0)}`,
        },
        { key: 'demandPrincipal', label: 'Demand Principal', align: 'right', render: (r) => fmtAmount(r.demandPrincipal), footerValue: (rows) => rows.reduce((s, r) => s + r.demandPrincipal, 0) },
        { key: 'demandInterest', label: 'Demand Interest', align: 'right', render: (r) => fmtAmount(r.demandInterest), footerValue: (rows) => rows.reduce((s, r) => s + r.demandInterest, 0) },
        { key: 'demandTotal', label: 'Demand Total', align: 'right', render: (r) => fmtAmount(r.demandTotal), footerValue: (rows) => rows.reduce((s, r) => s + r.demandTotal, 0) },
        {
            key: 'status',
            label: 'Status',
            align: 'center',
            render: (r) => (
                <span
                    className={
                        r.status === 'Collection Done'
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    }
                >
                    {r.status}
                </span>
            ),
        },
    ];

    return (
        <>
            <DrillDownModal
                open={open}
                onOpenChange={onOpenChange}
                title="Group Loan Details - Demand"
                subtitle={`Demand Date : ${fmtDdMmYyyy(date)}`}
            >
                <DrillDownTable
                    columns={columns}
                    rows={rows}
                    isLoading={isLoading}
                    searchPlaceholder="Search branch, center, group, officer..."
                    exportFileName={`group-loan-details-${date}`}
                    exportSheetName="Group Loan Details"
                    footer={(filteredRows) => {
                        const t = filteredRows.reduce(
                            (acc, r) => ({
                                collected: acc.collected + r.collectedMembers,
                                total: acc.total + r.totalMembers,
                                principal: acc.principal + r.demandPrincipal,
                                interest: acc.interest + r.demandInterest,
                                demandTotal: acc.demandTotal + r.demandTotal,
                            }),
                            { collected: 0, total: 0, principal: 0, interest: 0, demandTotal: 0 }
                        );
                        return (
                            <tr>
                                <td colSpan={8} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">Total</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-center text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{t.collected}/{t.total}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.principal)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.interest)}</td>
                                <td className="border-r border-primary/20 px-3 py-2.5 text-right text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">{fmtAmount(t.demandTotal)}</td>
                                <td className="px-3 py-2.5" />
                            </tr>
                        );
                    }}
                />
            </DrillDownModal>

            {selectedGroup && (
                <GroupMemberDetailsModal
                    open={!!selectedGroup}
                    onOpenChange={(o) => { if (!o) setSelectedGroup(null); }}
                    date={date}
                    groupId={selectedGroup.groupId}
                />
            )}
        </>
    );
}
