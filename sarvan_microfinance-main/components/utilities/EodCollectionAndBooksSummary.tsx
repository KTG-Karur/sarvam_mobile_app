'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowRight, BookOpen, ClipboardCheck, FileSearch, Landmark, Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { usePermission } from '@/app/hooks/usePermission';
import {
    EodPill,
    EodSectionCard,
    eodHeadCellClass,
    eodHeadRowClass,
    eodTableWrapClass,
} from '@/components/utilities/eod-ui';
import { cn } from '@/lib/utils';

interface DemandRow {
    centerName: string; centerCode: string; officerName: string; collectedByName: string; collectMode: string;
    demandPrincipal: number; demandInterest: number; demandLoanAdvance1: number; demandLoanAdvance2: number; demandTotal: number;
    receivedPrincipal: number; receivedInterest: number; receivedLoanAdvance1: number; receivedLoanAdvance2: number; receivedTotal: number;
    status: string;
}

interface BookRow {
    sNo: number; status: string; voucherType: string; voucherNo: string; particulars: string; debit: number; credit: number;
}

interface Book {
    openingBalance: number; closingBalance: number; totalDebit: number; totalCredit: number; rows: BookRow[];
}

interface EodSummaryResponse {
    demandCollection: { rows: DemandRow[]; totals: Omit<DemandRow, 'centerName' | 'centerCode' | 'officerName' | 'collectedByName' | 'collectMode' | 'status'> };
    cashBook: Book;
    bankBook: Book;
}

export type EodBookBalances = { bankClosingBalance: number; cashClosingBalance: number };

const formatCurrency = (amount: number): string =>
    `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DEMAND_COLLECTION_HREF = '/dashboard/collections/demand-collection';
const DAYBOOK_HREF = '/dashboard/admin-reports/account/daybook';

// Stable references so useTableSearch's internal useMemo (keyed on [rows]) doesn't
// rebuild its haystack every render while data hasn't loaded yet.
const EMPTY_DEMAND_ROWS: DemandRow[] = [];
const EMPTY_BOOK_ROWS: BookRow[] = [];

function ViewLink({ href, label }: { href: string; label: string }) {
    return (
        <Button asChild size="sm" className="h-8 bg-primary px-3 text-xs text-white hover:bg-sidebar-accent">
            <Link href={href}>
                {label}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
        </Button>
    );
}

function BookTable({ book, visibleRows, showBalance }: { book: Book; visibleRows: BookRow[]; showBalance: boolean }) {
    const colCount = showBalance ? 8 : 7;
    // Running balance is a display-only derivation over the full (unfiltered) rows
    // (opening + debit − credit), so searching never shifts a row's balance.
    const balanceBySNo = new Map<number, number>();
    let running = book.openingBalance;
    for (const r of book.rows) {
        running += (r.debit || 0) - (r.credit || 0);
        balanceBySNo.set(r.sNo, running);
    }

    return (
        <div className={eodTableWrapClass}>
            <Table>
                <TableHeader>
                    <TableRow className={eodHeadRowClass}>
                        <TableHead className={cn(eodHeadCellClass, 'w-[60px]')}>S.No</TableHead>
                        <TableHead className={eodHeadCellClass}>Status</TableHead>
                        <TableHead className={eodHeadCellClass}>Voucher Type</TableHead>
                        <TableHead className={eodHeadCellClass}>Voucher No</TableHead>
                        <TableHead className={eodHeadCellClass}>Particulars</TableHead>
                        <TableHead className={cn(eodHeadCellClass, 'text-right')}>Debit (₹)</TableHead>
                        <TableHead className={cn(eodHeadCellClass, 'text-right')}>Credit (₹)</TableHead>
                        {showBalance && <TableHead className={cn(eodHeadCellClass, 'text-right')}>Balance (₹)</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody className="text-xs">
                    <TableRow>
                        <TableCell colSpan={4} />
                        <TableCell className="font-medium">Opening Balance</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(book.openingBalance)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                        {showBalance && <TableCell className="text-right tabular-nums">{formatCurrency(book.openingBalance)}</TableCell>}
                    </TableRow>
                    {visibleRows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={colCount} className="py-6 text-center text-muted-foreground">No voucher entries for this date.</TableCell>
                        </TableRow>
                    ) : (
                        visibleRows.map((row) => {
                            const balance = balanceBySNo.get(row.sNo) ?? 0;
                            return (
                                <TableRow key={row.sNo}>
                                    <TableCell>{row.sNo}</TableCell>
                                    <TableCell>
                                        {row.status === 'APPROVED' ? (
                                            <EodPill tone="success">Posted</EodPill>
                                        ) : (
                                            <EodPill tone="warning">{row.status.replace(/_/g, ' ')}</EodPill>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{row.voucherType.replace('_', ' ')}</TableCell>
                                    <TableCell className="font-mono text-primary">{row.voucherNo}</TableCell>
                                    <TableCell className="max-w-[320px] whitespace-pre-line">{row.particulars}</TableCell>
                                    <TableCell className="text-right tabular-nums">{row.debit ? formatCurrency(row.debit) : '-'}</TableCell>
                                    <TableCell className="text-right tabular-nums">{row.credit ? formatCurrency(row.credit) : '-'}</TableCell>
                                    {showBalance && <TableCell className="text-right tabular-nums">{formatCurrency(balance)}</TableCell>}
                                </TableRow>
                            );
                        })
                    )}
                    <TableRow className="bg-slate-50 font-semibold hover:bg-slate-50 dark:bg-slate-900/60">
                        <TableCell colSpan={4} />
                        <TableCell>Total</TableCell>
                        {/* Debit column's "Total" must sum the entire column shown above it,
                            including the Opening Balance row (same convention as the Daybook
                            report's drTotal = ob + totalReceipts) — otherwise this row reads
                            as only the day's receipts and looks short of the Opening Balance
                            line sitting right above it. */}
                        <TableCell className="text-right tabular-nums">{formatCurrency(book.openingBalance + book.totalDebit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(book.totalCredit)}</TableCell>
                        {showBalance && <TableCell className="text-right tabular-nums">{formatCurrency(book.closingBalance)}</TableCell>}
                    </TableRow>
                    <TableRow>
                        <TableCell colSpan={4} />
                        <TableCell className="font-medium">Closing Balance</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                            {formatCurrency(book.closingBalance)} {book.closingBalance >= 0 ? 'Dr' : 'Cr'}
                        </TableCell>
                        <TableCell />
                        {showBalance && <TableCell />}
                    </TableRow>
                </TableBody>
            </Table>
        </div>
    );
}

export function EodCollectionAndBooksSummary({
    branchId,
    dateYmd,
    onBalancesChange,
}: {
    branchId: string;
    dateYmd: string;
    onBalancesChange?: (balances: EodBookBalances | null) => void;
}) {
    const [data, setData] = useState<EodSummaryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const { canPage } = usePermission();

    const fetchData = useCallback(async () => {
        if (!branchId || !dateYmd) return;
        setIsLoading(true);
        try {
            const result = await apiClient.get<EodSummaryResponse>(`/utilities/eod-process/summary?branchId=${branchId}&date=${dateYmd}`);
            if (result.success && result.data) setData(result.data);
        } finally {
            setIsLoading(false);
        }
    }, [branchId, dateYmd]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    useEffect(() => {
        onBalancesChange?.(
            data
                ? { bankClosingBalance: data.bankBook.closingBalance, cashClosingBalance: data.cashBook.closingBalance }
                : null
        );
    }, [data, onBalancesChange]);

    // Hooks must run unconditionally (before the loading/!data early returns below) —
    // three independent search boxes, one per table, since each is a distinct list.
    const { query: demandQuery, setQuery: setDemandQuery, filtered: filteredDemandRows } = useTableSearch(
        data?.demandCollection.rows ?? EMPTY_DEMAND_ROWS
    );
    const { query: cashQuery, setQuery: setCashQuery, filtered: filteredCashRows } = useTableSearch(
        data?.cashBook.rows ?? EMPTY_BOOK_ROWS
    );
    const { query: bankQuery, setQuery: setBankQuery, filtered: filteredBankRows } = useTableSearch(
        data?.bankBook.rows ?? EMPTY_BOOK_ROWS
    );

    if (isLoading && !data) {
        return (
            <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-card py-10 text-sm text-muted-foreground shadow-sm dark:border-slate-800">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" /> Loading demand collection & books...
            </div>
        );
    }

    if (!data) return null;

    const { demandCollection, cashBook, bankBook } = data;
    const demandColSpan = loanAdvanceEnabled ? 13 : 11;
    const canViewDemand = canPage(DEMAND_COLLECTION_HREF, 'view');
    const canViewDaybook = canPage(DAYBOOK_HREF, 'view');

    return (
        <div className="space-y-6">
            <EodSectionCard
                icon={ClipboardCheck}
                title="Demand Collection"
                actions={
                    <>
                        {demandCollection.rows.length > 0 && (
                            <TableSearchInput
                                value={demandQuery}
                                onChange={setDemandQuery}
                                placeholder="Search demand collection..."
                            />
                        )}
                        {canViewDemand && <ViewLink href={DEMAND_COLLECTION_HREF} label="View Details" />}
                    </>
                }
            >
                <div className={eodTableWrapClass}>
                    <Table>
                        <TableHeader>
                            <TableRow className={eodHeadRowClass}>
                                <TableHead rowSpan={2} className={cn(eodHeadCellClass, 'border-r align-middle')}>Center Name</TableHead>
                                <TableHead rowSpan={2} className={cn(eodHeadCellClass, 'border-r align-middle')}>Officer Name</TableHead>
                                <TableHead rowSpan={2} className={cn(eodHeadCellClass, 'border-r align-middle')}>Collected By</TableHead>
                                <TableHead rowSpan={2} className={cn(eodHeadCellClass, 'border-r align-middle')}>Collect Mode</TableHead>
                                <TableHead colSpan={loanAdvanceEnabled ? 4 : 3} className={cn(eodHeadCellClass, 'border-r border-b text-center')}>Today Demand</TableHead>
                                <TableHead colSpan={loanAdvanceEnabled ? 4 : 3} className={cn(eodHeadCellClass, 'border-r border-b text-center')}>Today Received</TableHead>
                                <TableHead rowSpan={2} className={cn(eodHeadCellClass, 'text-center align-middle')}>Status</TableHead>
                            </TableRow>
                            <TableRow className={eodHeadRowClass}>
                                <TableHead className={cn(eodHeadCellClass, 'text-right')}>Principal</TableHead>
                                <TableHead className={cn(eodHeadCellClass, 'text-right')}>Interest</TableHead>
                                {loanAdvanceEnabled && <TableHead className={cn(eodHeadCellClass, 'text-right')}>Loan Advance</TableHead>}
                                <TableHead className={cn(eodHeadCellClass, 'border-r text-right')}>Total</TableHead>
                                <TableHead className={cn(eodHeadCellClass, 'text-right')}>Principal</TableHead>
                                <TableHead className={cn(eodHeadCellClass, 'text-right')}>Interest</TableHead>
                                {loanAdvanceEnabled && <TableHead className={cn(eodHeadCellClass, 'text-right')}>Loan Advance</TableHead>}
                                <TableHead className={cn(eodHeadCellClass, 'border-r text-right')}>Total</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="text-xs">
                            {demandCollection.rows.length === 0 ? (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={demandColSpan} className="py-10 text-center">
                                        <FileSearch className="mx-auto mb-2 h-10 w-10 text-slate-300 dark:text-slate-600" strokeWidth={1.25} />
                                        <p className="text-xs text-muted-foreground">No collections recorded for this date.</p>
                                    </TableCell>
                                </TableRow>
                            ) : filteredDemandRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={demandColSpan} className="py-6 text-center text-muted-foreground">No rows match your search.</TableCell>
                                </TableRow>
                            ) : (
                                filteredDemandRows.map((row) => (
                                    <TableRow key={`${row.centerCode}-${row.centerName}`}>
                                        <TableCell className="font-medium">{row.centerCode ? `${row.centerCode} - ${row.centerName}` : row.centerName}</TableCell>
                                        <TableCell>{row.officerName}</TableCell>
                                        <TableCell>{row.collectedByName}</TableCell>
                                        <TableCell>{row.collectMode}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(row.demandPrincipal)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(row.demandInterest)}</TableCell>
                                        {loanAdvanceEnabled && <TableCell className="text-right tabular-nums">{formatCurrency(row.demandLoanAdvance1)}</TableCell>}
                                        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(row.demandTotal)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(row.receivedPrincipal)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(row.receivedInterest)}</TableCell>
                                        {loanAdvanceEnabled && <TableCell className="text-right tabular-nums">{formatCurrency(row.receivedLoanAdvance1)}</TableCell>}
                                        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(row.receivedTotal)}</TableCell>
                                        <TableCell className="text-center">
                                            <EodPill tone="neutral">{row.status}</EodPill>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                            {demandCollection.rows.length > 0 && (
                                <TableRow className="bg-slate-50 font-semibold hover:bg-slate-50 dark:bg-slate-900/60">
                                    <TableCell colSpan={4}>Total</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.demandPrincipal)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.demandInterest)}</TableCell>
                                    {loanAdvanceEnabled && <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.demandLoanAdvance1)}</TableCell>}
                                    <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.demandTotal)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.receivedPrincipal)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.receivedInterest)}</TableCell>
                                    {loanAdvanceEnabled && <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.receivedLoanAdvance1)}</TableCell>}
                                    <TableCell className="text-right tabular-nums">{formatCurrency(demandCollection.totals.receivedTotal)}</TableCell>
                                    <TableCell />
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </EodSectionCard>

            <EodSectionCard
                icon={Landmark}
                title="Bank Book"
                actions={
                    <>
                        {bankBook.rows.length > 0 && (
                            <TableSearchInput value={bankQuery} onChange={setBankQuery} placeholder="Search bank book..." />
                        )}
                        {canViewDaybook && <ViewLink href={DAYBOOK_HREF} label="View All" />}
                    </>
                }
            >
                <BookTable book={bankBook} visibleRows={filteredBankRows} showBalance />
            </EodSectionCard>

            <EodSectionCard
                icon={BookOpen}
                title="Cash Book"
                actions={
                    cashBook.rows.length > 0 ? (
                        <TableSearchInput value={cashQuery} onChange={setCashQuery} placeholder="Search..." />
                    ) : undefined
                }
            >
                <BookTable book={cashBook} visibleRows={filteredCashRows} showBalance={false} />
            </EodSectionCard>
        </div>
    );
}
