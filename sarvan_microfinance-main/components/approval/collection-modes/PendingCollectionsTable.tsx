'use client';

import { useMemo, useState } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { CollectionRow, DenominationCenterRow, formatCurrency, formatDate } from './types';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';

const DENOMINATION_COLUMNS: Array<[label: string, key: keyof DenominationCenterRow]> = [
    ['500', 'd500'], ['200', 'd200'], ['100', 'd100'], ['50', 'd50'],
    ['20', 'd20'], ['10', 'd10'], ['5', 'd5'], ['2', 'd2'], ['1', 'd1'],
];

interface SummaryCard {
    label: string;
    value: number;
}

function SummaryCards({ cards }: { cards: SummaryCard[] }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map((card) => (
                <div key={card.label} className="bg-green-50 dark:bg-brand-green-darker/30 rounded-lg p-3 border border-primary/20">
                    <div className="text-xs text-primary font-medium">{card.label}</div>
                    <div className="text-lg font-bold text-sidebar-accent mt-1">{formatCurrency(card.value)}</div>
                </div>
            ))}
        </div>
    );
}

export function CollectionDenominationDetails({ centers }: { centers: DenominationCenterRow[] }) {
    if (centers.length === 0) return null;
    const totals = centers.reduce(
        (acc, c) => {
            DENOMINATION_COLUMNS.forEach(([, key]) => { acc[key] = (acc[key] as number) + (c[key] as number); });
            acc.totalAmount += c.totalAmount;
            return acc;
        },
        { d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0, totalAmount: 0 } as Record<string, number>
    );

    return (
        <div className="mt-6">
            <h3 className="text-sm font-semibold mb-2">Collection Denomination Details</h3>
            <div className="rounded-lg border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Center Name</TableHead>
                            {DENOMINATION_COLUMNS.map(([label]) => (
                                <TableHead key={label} className="text-right">₹ {label}</TableHead>
                            ))}
                            <TableHead className="text-right">Total Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {centers.map((c) => (
                            <TableRow key={`${c.centerCode}-${c.centerName}`}>
                                <TableCell>{c.centerCode ? `${c.centerCode} - ${c.centerName}` : c.centerName}</TableCell>
                                {DENOMINATION_COLUMNS.map(([label, key]) => (
                                    <TableCell key={label} className="text-right">{(c[key] as number) || ''}</TableCell>
                                ))}
                                <TableCell className="text-right font-medium">{c.totalAmount}</TableCell>
                            </TableRow>
                        ))}
                        <TableRow className="font-bold bg-muted/40">
                            <TableCell>Total</TableCell>
                            {DENOMINATION_COLUMNS.map(([label, key]) => (
                                <TableCell key={label} className="text-right">{totals[key]}</TableCell>
                            ))}
                            <TableCell className="text-right">{totals.totalAmount}</TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

interface PendingCollectionsTableProps {
    rows: CollectionRow[];
    collectionLabel: string; // e.g. "Demand Collection", "Arrear Collection"
    showDueColumns?: boolean;
    showApprove?: boolean;
    canApprove: boolean;
    emptyText: string;
    onApprove?: (transactionId: string) => Promise<void>;
    /** Funder-wise "Approve All" — approves every pending row under one funder in a single request. */
    onApproveMany?: (transactionIds: string[]) => Promise<void>;
    /** True while ANY approval request (from any tab) is in flight — locks every Approve button. */
    approvalLocked?: boolean;
    /** Transaction IDs approved in this session — row stays visible with a tick instead of disappearing. */
    approvedIds?: Set<string>;
    denominationCenters?: DenominationCenterRow[];
}

/** Groups rows by funder, preserving the order each funder first appears in — used to render
 *  a "Funder: X" header (with a bulk Approve All action) above that funder's rows. */
function groupRowsByFunder(rows: CollectionRow[]): Array<{ funderName: string; rows: CollectionRow[] }> {
    const map = new Map<string, CollectionRow[]>();
    for (const row of rows) {
        const key = row.funderName || 'own fund';
        const existing = map.get(key);
        if (existing) {
            existing.push(row);
        } else {
            map.set(key, [row]);
        }
    }
    return Array.from(map.entries()).map(([funderName, groupRows]) => ({ funderName, rows: groupRows }));
}

export function PendingCollectionsTable({
    rows,
    collectionLabel,
    showDueColumns = true,
    showApprove = true,
    canApprove,
    emptyText,
    onApprove,
    onApproveMany,
    approvedIds,
    approvalLocked = false,
    denominationCenters,
}: PendingCollectionsTableProps) {
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [bulkProcessingFunder, setBulkProcessingFunder] = useState<string | null>(null);
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();

    const summary = useMemo(() => {
        const loanAmount = rows.reduce((s, r) => s + r.loanAmount, 0);
        const demandAmount = rows.reduce((s, r) => s + r.principalAmount + r.interestAmount, 0);
        const collectionAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
        const arrearAmount = rows.filter((r) => r.mode === 'ARREAR').reduce((s, r) => s + r.totalAmount, 0);
        const walletPay = rows.reduce((s, r) => s + r.walletPay, 0);
        return { loanAmount, demandAmount, collectionAmount, arrearAmount, walletPay };
    }, [rows]);

    const handleApprove = async (transactionId: string) => {
        if (!onApprove) return;
        setProcessingId(transactionId);
        try {
            await onApprove(transactionId);
        } finally {
            setProcessingId(null);
        }
    };

    const handleApproveFunder = async (funderName: string, transactionIds: string[]) => {
        if (!onApproveMany || transactionIds.length === 0) return;
        setBulkProcessingFunder(funderName);
        try {
            await onApproveMany(transactionIds);
        } finally {
            setBulkProcessingFunder(null);
        }
    };

    const funderGroups = useMemo(() => groupRowsByFunder(rows), [rows]);
    const totalColSpan = 9 + (showDueColumns ? 2 : 0) + (showApprove ? 1 : 0) - (loanAdvanceEnabled ? 0 : 1);
    const anyProcessing = !!processingId || !!bulkProcessingFunder || approvalLocked;

    return (
        <div className="space-y-4">
            <SummaryCards
                cards={[
                    { label: 'Loan Amount', value: summary.loanAmount },
                    { label: collectionLabel.replace('Collection', 'Demand'), value: summary.demandAmount },
                    { label: 'Collection Amount', value: summary.collectionAmount },
                    { label: 'Arrear Amount', value: summary.arrearAmount },
                    { label: 'Wallet Pay', value: summary.walletPay },
                ]}
            />

            <div className="rounded-lg border overflow-x-auto bg-white dark:bg-brand-green-darker/10">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead rowSpan={2} className="align-bottom">S.No</TableHead>
                            <TableHead rowSpan={2} className="align-bottom">Member #</TableHead>
                            <TableHead rowSpan={2} className="align-bottom">Member Name</TableHead>
                            <TableHead rowSpan={2} className="align-bottom">Product Name</TableHead>
                            {showDueColumns && <TableHead rowSpan={2} className="align-bottom text-center"># Due</TableHead>}
                            {showDueColumns && <TableHead rowSpan={2} className="align-bottom">Due Date</TableHead>}
                            <TableHead rowSpan={2} className="align-bottom">Collection Date</TableHead>
                            <TableHead colSpan={3} className="text-center">{collectionLabel}</TableHead>
                            {loanAdvanceEnabled && (
                                <TableHead rowSpan={2} className="align-bottom text-right">Total Loan Advance</TableHead>
                            )}
                            <TableHead rowSpan={2} className="align-bottom text-right">Total Amount</TableHead>
                            <TableHead rowSpan={2} className="align-bottom">Collected By</TableHead>
                            <TableHead rowSpan={2} className="align-bottom">Funder</TableHead>
                            {showApprove && <TableHead rowSpan={2} className="align-bottom">Approve Collection</TableHead>}
                        </TableRow>
                        <TableRow>
                            <TableHead className="text-right">Principal</TableHead>
                            <TableHead className="text-right">Interest</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={totalColSpan} className="text-center text-muted-foreground py-8">
                                    {emptyText}
                                </TableCell>
                            </TableRow>
                        ) : (
                            (() => {
                                let idx = 0;
                                return funderGroups.flatMap((group) => {
                                    const pendingIdsInGroup = group.rows
                                        .filter((r) => r.status !== 'APPROVED' && !approvedIds?.has(r.transactionId))
                                        .map((r) => r.transactionId);

                                    const rowsOut = [
                                        <TableRow key={`funder-header-${group.funderName}`} className="bg-muted/40 hover:bg-muted/40">
                                            <TableCell colSpan={totalColSpan} className="py-2">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-xs font-semibold text-sidebar-accent uppercase tracking-wide">
                                                        Funder: {group.funderName}
                                                    </span>
                                                    {showApprove && onApproveMany && canApprove && pendingIdsInGroup.length > 0 && (
                                                        <Button
                                                            size="sm"
                                                            className="bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                                                            disabled={anyProcessing}
                                                            onClick={() => handleApproveFunder(group.funderName, pendingIdsInGroup)}
                                                        >
                                                            {bulkProcessingFunder === group.funderName ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve All ({pendingIdsInGroup.length})</>
                                                            )}
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>,
                                        ...group.rows.map((row) => {
                                            idx += 1;
                                            const rowIdx = idx;
                                            return (
                                                <TableRow key={row.transactionId}>
                                                    <TableCell>{rowIdx}</TableCell>
                                                    <TableCell className="font-mono text-xs">{row.clientCode}</TableCell>
                                                    <TableCell>{row.clientName}</TableCell>
                                                    <TableCell>{row.productName}</TableCell>
                                                    {showDueColumns && <TableCell className="text-center">{row.dueCount}</TableCell>}
                                                    {showDueColumns && <TableCell>{formatDate(row.dueDate)}</TableCell>}
                                                    <TableCell>{formatDate(row.collectionDate)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(row.principalAmount)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(row.interestAmount)}</TableCell>
                                                    <TableCell className="text-right font-medium">{formatCurrency(row.totalAmount)}</TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="text-right">{formatCurrency(row.loanAdvanceAmount)}</TableCell>
                                                    )}
                                                    <TableCell className="text-right font-semibold text-sidebar-accent">
                                                        {formatCurrency(row.totalAmount + (loanAdvanceEnabled ? row.loanAdvanceAmount : 0))}
                                                    </TableCell>
                                                    <TableCell className="text-xs">{row.collectedByName}</TableCell>
                                                    <TableCell className="text-xs">{row.funderName}</TableCell>
                                                    {showApprove && (
                                                        <TableCell>
                                                            {row.status === 'APPROVED' || approvedIds?.has(row.transactionId) ? (
                                                                <span
                                                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                                    title="Approved"
                                                                >
                                                                    <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                                                                </span>
                                                            ) : canApprove ? (
                                                                <Button
                                                                    size="sm"
                                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                                                    disabled={anyProcessing}
                                                                    onClick={() => handleApprove(row.transactionId)}
                                                                >
                                                                    {processingId === row.transactionId ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    ) : (
                                                                        <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve</>
                                                                    )}
                                                                </Button>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">—</span>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            );
                                        }),
                                    ];
                                    return rowsOut;
                                });
                            })()
                        )}
                    </TableBody>
                </Table>
            </div>

            {denominationCenters && <CollectionDenominationDetails centers={denominationCenters} />}
        </div>
    );
}
