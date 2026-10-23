'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import { DrillDownModal } from './DrillDownModal';
import { DrillDownTable, DrillDownColumn } from './DrillDownTable';

export interface GroupMemberRow {
    groupName: string;
    memberId: string;
    memberName: string;
    memberPhone: string;
    absentCount: number;
    installment: string;
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
    groupId: string;
}

export function GroupMemberDetailsModal({ open, onOpenChange, date, groupId }: Props) {
    const [rows, setRows] = useState<GroupMemberRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        Promise.resolve().then(() => { if (!cancelled) setIsLoading(true); });
        const params = new URLSearchParams({ modal: 'group-members', date, groupId });
        apiClient
            .get<{ rows: GroupMemberRow[] }>(`/dashboard/v2/demand-drilldown?${params.toString()}`)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) setRows(res.data.rows);
            })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [open, date, groupId]);

    const columns: DrillDownColumn<GroupMemberRow>[] = [
        { key: 'groupName', label: 'Group Name' },
        { key: 'memberId', label: 'Member ID' },
        { key: 'memberName', label: 'Member Name' },
        { key: 'memberPhone', label: 'Member Phone Number' },
        { key: 'absentCount', label: 'Absent Count', align: 'center' },
        { key: 'installment', label: 'Installment', align: 'center', sortable: false },
        { key: 'principal', label: 'Principal', align: 'right', render: (r) => fmtAmount(r.principal), footerValue: (rows) => rows.reduce((s, r) => s + r.principal, 0) },
        { key: 'interest', label: 'Interest', align: 'right', render: (r) => fmtAmount(r.interest), footerValue: (rows) => rows.reduce((s, r) => s + r.interest, 0) },
        { key: 'total', label: 'Total', align: 'right', render: (r) => fmtAmount(r.total), footerValue: (rows) => rows.reduce((s, r) => s + r.total, 0) },
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
        <DrillDownModal
            open={open}
            onOpenChange={onOpenChange}
            title="Group Member Details - Demand"
            subtitle={`Demand Date : ${fmtDdMmYyyy(date)}`}
        >
            <DrillDownTable
                columns={columns}
                rows={rows}
                isLoading={isLoading}
                searchPlaceholder="Search member name, ID, phone..."
                exportFileName={`group-member-details-${date}`}
                exportSheetName="Group Member Details"
                footer={(filteredRows) => {
                    const t = filteredRows.reduce(
                        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.total }),
                        { principal: 0, interest: 0, total: 0 }
                    );
                    return (
                        <tr>
                            <td colSpan={6} className="border-r border-primary/20 px-3 py-2.5 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">Total</td>
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
