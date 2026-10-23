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
import type { LoanCardScheduleRow, ParsedLoanCardReport } from '@/app/lib/services/uploan-loan-history.service';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

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

interface LoanCardScheduleTableProps {
    report: ParsedLoanCardReport;
    /** Edits are pushed straight back to the caller's own state — this component holds no local state.
     *  Omit to render a plain read-only view (e.g. reviewing an already-migrated backup loan's history). */
    onChange?: (updated: ParsedLoanCardReport) => void;
    /** When provided, an "Add row" button appends a new installment row (parent assigns its
     *  number + rowId) and a per-row trash button removes one by array index. */
    onAddRow?: () => void;
    onDeleteRow?: (index: number) => void;
}

export function LoanCardScheduleTable({ report, onChange, onAddRow, onDeleteRow }: LoanCardScheduleTableProps) {
    const editable = !!onChange;
    const canEditRows = !!onAddRow || !!onDeleteRow;

    const updateHeader = <K extends keyof ParsedLoanCardReport>(field: K, value: ParsedLoanCardReport[K]) => {
        onChange?.({ ...report, [field]: value });
    };

    // Matched by array index, not installmentNo — an editable grid can transiently hold two
    // rows with the same number while the user is renumbering.
    const updateRow = <K extends keyof LoanCardScheduleRow>(index: number, field: K, value: LoanCardScheduleRow[K]) => {
        onChange?.({
            ...report,
            scheduleRows: report.scheduleRows.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
        });
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="space-y-1">
                    <span className="text-gray-500 block">Contract Code:</span>
                    {editable ? (
                        <Input className="h-8 text-sm" value={report.contractCode} onChange={(e) => updateHeader('contractCode', e.target.value)} />
                    ) : (
                        <span>{report.contractCode || '—'}</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Officer:</span>
                    {editable ? (
                        <Input className="h-8 text-sm" value={report.officerName} onChange={(e) => updateHeader('officerName', e.target.value)} />
                    ) : (
                        <span>{report.officerName || '—'}</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Group:</span>
                    {editable ? (
                        <Input className="h-8 text-sm" value={report.groupName} onChange={(e) => updateHeader('groupName', e.target.value)} />
                    ) : (
                        <span>{report.groupName || '—'}</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Funder:</span>
                    {editable ? (
                        <Input className="h-8 text-sm" value={report.funderName} onChange={(e) => updateHeader('funderName', e.target.value)} />
                    ) : (
                        <span>{report.funderName || '—'}</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Amount:</span>
                    {editable ? (
                        <Input
                            type="number"
                            className="h-8 text-sm"
                            value={report.amount}
                            onChange={(e) => updateHeader('amount', Number(e.target.value))}
                        />
                    ) : (
                        <span>₹{report.amount}</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Rate:</span>
                    {editable ? (
                        <Input
                            type="number"
                            className="h-8 text-sm"
                            value={report.interestRate}
                            onChange={(e) => updateHeader('interestRate', Number(e.target.value))}
                        />
                    ) : (
                        <span>{report.interestRate}%</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Installments:</span>
                    {editable ? (
                        <Input
                            type="number"
                            className="h-8 text-sm"
                            value={report.installments}
                            onChange={(e) => updateHeader('installments', Number(e.target.value))}
                        />
                    ) : (
                        <span>{report.installments}</span>
                    )}
                </div>
                <div className="space-y-1">
                    <span className="text-gray-500 block">Disbursed:</span>
                    {editable ? (
                        <DateInput
                            className="h-8 text-sm"
                            value={toDateInputValue(report.disbursementDate)}
                            onChange={(e) => updateHeader('disbursementDate', fromDateInputValue(e.target.value, report.disbursementDate))}
                        />
                    ) : (
                        <span>{report.disbursementDate ? toDisplayDate(new Date(report.disbursementDate)) : '—'}</span>
                    )}
                </div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Due Date</TableHead>
                            <TableHead>Principal</TableHead>
                            <TableHead>Interest</TableHead>
                            <TableHead>Savings</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Outstanding</TableHead>
                            <TableHead>Received Date</TableHead>
                            <TableHead>Received Amt</TableHead>
                            {canEditRows && <TableHead className="w-10" />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {report.scheduleRows.map((row, index) => (
                            <TableRow key={row.rowId ?? row.installmentNo}>
                                <TableCell>
                                    {canEditRows ? (
                                        <Input
                                            type="number"
                                            className="h-8 w-16 text-sm"
                                            value={row.installmentNo}
                                            onChange={(e) => updateRow(index, 'installmentNo', Number(e.target.value))}
                                        />
                                    ) : (
                                        row.installmentNo
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <DateInput
                                            className="h-8 min-w-[140px] text-sm"
                                            value={toDateInputValue(row.dueDate)}
                                            onChange={(e) =>
                                                updateRow(index, 'dueDate', fromDateInputValue(e.target.value, row.dueDate) ?? row.dueDate)
                                            }
                                        />
                                    ) : (
                                        toDisplayDate(new Date(row.dueDate))
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={row.principalDue}
                                            onChange={(e) => updateRow(index, 'principalDue', Number(e.target.value))}
                                        />
                                    ) : (
                                        row.principalDue
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={row.interestDue}
                                            onChange={(e) => updateRow(index, 'interestDue', Number(e.target.value))}
                                        />
                                    ) : (
                                        row.interestDue
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={row.savingsDue}
                                            onChange={(e) => updateRow(index, 'savingsDue', Number(e.target.value))}
                                        />
                                    ) : (
                                        row.savingsDue
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={row.totalDue}
                                            onChange={(e) => updateRow(index, 'totalDue', Number(e.target.value))}
                                        />
                                    ) : (
                                        row.totalDue
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[100px] text-sm"
                                            value={row.outstandingBalance}
                                            onChange={(e) => updateRow(index, 'outstandingBalance', Number(e.target.value))}
                                        />
                                    ) : (
                                        row.outstandingBalance
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <DateInput
                                            className="h-8 min-w-[140px] text-sm"
                                            value={toDateInputValue(row.receivedDate)}
                                            onChange={(e) => updateRow(index, 'receivedDate', fromDateInputValue(e.target.value, row.receivedDate))}
                                        />
                                    ) : row.receivedDate ? (
                                        toDisplayDateTime(new Date(row.receivedDate))
                                    ) : (
                                        '—'
                                    )}
                                </TableCell>
                                <TableCell>
                                    {editable ? (
                                        <Input
                                            type="number"
                                            className="h-8 min-w-[90px] text-sm"
                                            value={row.receivedAmount ?? ''}
                                            onChange={(e) =>
                                                updateRow(index, 'receivedAmount', e.target.value === '' ? null : Number(e.target.value))
                                            }
                                        />
                                    ) : (
                                        row.receivedAmount ?? '—'
                                    )}
                                </TableCell>
                                {canEditRows && (
                                    <TableCell>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                                            title="Delete this installment row"
                                            onClick={() => onDeleteRow?.(index)}
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
                    Add installment row
                </Button>
            )}
        </div>
    );
}
