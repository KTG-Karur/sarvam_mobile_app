'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { ParsedRepaymentReport, RepaymentEvent } from '@/app/lib/services/uploan-loan-history.service';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

function toDateInputValue(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Falls back to the previous value on an empty/invalid date input, so a bad edit never corrupts the stored ISO string. */
function fromDateInputValue(value: string, previous: string | null): string | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? previous : d.toISOString();
}

interface RepaymentEventTableProps {
    report: ParsedRepaymentReport;
    /** Edits are pushed straight back to the caller's own state — this component holds no local state.
     *  Omit to render a plain read-only view (e.g. reviewing an already-migrated backup loan's history). */
    onChange?: (updated: ParsedRepaymentReport) => void;
    /** When provided, an "Add row" button appends a blank event and a per-row trash button removes one. */
    onAddRow?: () => void;
    onDeleteRow?: (index: number) => void;
}

export function RepaymentEventTable({ report, onChange, onAddRow, onDeleteRow }: RepaymentEventTableProps) {
    const editable = !!onChange;
    const canEditRows = !!onAddRow || !!onDeleteRow;

    const updateEvent = <K extends keyof RepaymentEvent>(index: number, field: K, value: RepaymentEvent[K]) => {
        onChange?.({
            ...report,
            events: report.events.map((evt, i) => (i === index ? { ...evt, [field]: value } : evt)),
        });
    };

    return (
        <div className="space-y-3">
            <div className="overflow-x-auto border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Due #</TableHead>
                            <TableHead>Txn Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Principal</TableHead>
                            <TableHead>Interest</TableHead>
                            <TableHead>Loan Balance</TableHead>
                            <TableHead>Wallet Pay</TableHead>
                            <TableHead>Wallet Balance</TableHead>
                            {canEditRows && <TableHead className="w-10" />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {report.events.map((evt, i) => (
                            <TableRow key={evt.rowId ?? i}>
                                <TableCell>
                                    {editable ? (
                                        <Input className="h-8 min-w-[70px] text-sm" value={evt.dueNo} onChange={(e) => updateEvent(i, 'dueNo', e.target.value)} />
                                    ) : (
                                        evt.dueNo
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <DateInput
                                            className="h-8 min-w-[140px] text-sm"
                                            value={toDateInputValue(evt.transactionDate)}
                                            onChange={(e) =>
                                                updateEvent(i, 'transactionDate', fromDateInputValue(e.target.value, evt.transactionDate) ?? evt.transactionDate)
                                            }
                                        />
                                    ) : (
                                        toDisplayDate(new Date(evt.transactionDate))
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            className="h-8 min-w-[110px] text-sm"
                                            value={evt.transactionType}
                                            onChange={(e) => updateEvent(i, 'transactionType', e.target.value)}
                                        />
                                    ) : (
                                        evt.transactionType
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={evt.amount}
                                            onChange={(e) => updateEvent(i, 'amount', Number(e.target.value))}
                                        />
                                    ) : (
                                        evt.amount
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={evt.principalAmount}
                                            onChange={(e) => updateEvent(i, 'principalAmount', Number(e.target.value))}
                                        />
                                    ) : (
                                        evt.principalAmount
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={evt.interestAmount}
                                            onChange={(e) => updateEvent(i, 'interestAmount', Number(e.target.value))}
                                        />
                                    ) : (
                                        evt.interestAmount
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[100px] text-sm"
                                            value={evt.loanBalance}
                                            onChange={(e) => updateEvent(i, 'loanBalance', Number(e.target.value))}
                                        />
                                    ) : (
                                        evt.loanBalance
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={evt.walletPayAmount || ''}
                                            onChange={(e) => updateEvent(i, 'walletPayAmount', e.target.value === '' ? 0 : Number(e.target.value))}
                                        />
                                    ) : (
                                        evt.walletPayAmount || '—'
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[100px] text-sm"
                                            value={evt.walletBalance || ''}
                                            onChange={(e) => updateEvent(i, 'walletBalance', e.target.value === '' ? 0 : Number(e.target.value))}
                                        />
                                    ) : (
                                        evt.walletBalance || '—'
                                    )}
                                </TableCell>
                                {canEditRows && (
                                    <TableCell>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                                            title="Delete this event row"
                                            onClick={() => onDeleteRow?.(i)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            {onAddRow && (
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onAddRow}>
                    <Plus className="h-4 w-4" />
                    Add event row
                </Button>
            )}
        </div>
    );
}
