'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { CashReceiptForm, CashReceiptFormData, CashReceiptEditData } from '@/components/transactions/CashReceiptForm';
import { CashReceiptTable, CashReceiptRow } from '@/components/transactions/CashReceiptTable';
import { Wallet } from 'lucide-react';
import { tokenStorage } from '@/app/lib/token-storage';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { reportHeaderRows, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { PageLoader } from '@/components/ui/page-loader';

type ApprovalTab = 'all' | 'pending' | 'approved' | 'rejected';
const TAB_APPROVAL_STATUS: Record<Exclude<ApprovalTab, 'all'>, string> = {
    pending: 'PENDING_APPROVAL',
    approved: 'APPROVED',
    rejected: 'REJECTED',
};

const monthToDateRange = () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];
    return { from, to };
};

const PAGE_SIZE = 10;

export function CashReceiptPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [selfAccounts, setSelfAccounts] = useState<{ id: string; name: string }[]>([]);
    const [ledgers, setLedgers] = useState<{ id: string; name: string }[]>([]);
    const [branchFilter, setBranchFilter] = useState('all');
    const [editingRow, setEditingRow] = useState<CashReceiptRow | null>(null);
    const sessionUser = useMemo(() => tokenStorage.getUser(), []);
    const isDateEditable = sessionUser?.role === 'ADMIN';
    const isAM = sessionUser?.role === 'AREA_MANAGER';

    // Filters (moved up from CashReceiptTable so pagination/search/tab can be server-driven)
    const [activeTab, setActiveTab] = useState<ApprovalTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const initialRange = monthToDateRange();
    const [fromDate, setFromDate] = useState(initialRange.from);
    const [toDate, setToDate] = useState(initialRange.to);

    // Non-AM: server-paginated rows + metadata. AM: full unfiltered rows, paginated client-side.
    const [serverRows, setServerRows] = useState<CashReceiptRow[]>([]);
    const [amRows, setAmRows] = useState<CashReceiptRow[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    const fetchTransactions = useCallback(async (branchId: string, pageArg: number = 1) => {
        if (isAM) {
            const params = new URLSearchParams({ type: 'CASH_RECEIPT' });
            if (branchId && branchId !== 'all') params.set('branchId', branchId);
            const txRes = await fetch(`/api/transactions/approval?${params.toString()}`);
            const txData = await txRes.json();
            if (txRes.ok) {
                setAmRows(txData.data?.transactions || []);
            }
            return;
        }
        const params = new URLSearchParams({
            fromDate,
            toDate,
            page: String(pageArg),
            pageSize: String(PAGE_SIZE),
        });
        if (branchId && branchId !== 'all') params.set('branchId', branchId);
        if (activeTab !== 'all') params.set('approvalStatus', TAB_APPROVAL_STATUS[activeTab]);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const txRes = await fetch(`/api/transactions/cash-receipt?${params.toString()}`);
        const txData = await txRes.json();
        if (txRes.ok && txData.success) {
            setServerRows(txData.data.transactions ?? []);
            setTotalPages(txData.data.totalPages || 1);
            setTotalCount(txData.data.totalCount ?? 0);
            setPage(txData.data.page ?? pageArg);
        } else {
            setServerRows([]);
            setTotalPages(1);
            setTotalCount(0);
        }
    }, [isAM, fromDate, toDate, activeTab, debouncedSearch]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [accRes, ledRes] = await Promise.all([
                fetch('/api/accounts/self?type=CASH'),
                fetch('/api/accounts/ledgers'),
            ]);

            const accData = await accRes.json();
            const ledData = await ledRes.json();

            setSelfAccounts(accData.data || accData || []);
            setLedgers((ledData.data || ledData || []).map((l: any) => ({
                id: l.id,
                name: l.ledgerName || l.name
            })));
            await fetchTransactions(branchFilter, 1);

        } catch (error: any) {
            console.error('Error fetching data:', error);
            toast({
                title: 'Data Load Error',
                description: 'Failed to load initial data. Please refresh.',
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toast, fetchTransactions]);

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Refetch page 1 whenever branch, tab, search, or date range changes.
    useEffect(() => {
        setPage(1);
        fetchTransactions(branchFilter, 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchFilter, activeTab, debouncedSearch, fromDate, toDate]);

    const handlePageChange = useCallback((p: number) => {
        if (isAM) {
            setPage(p);
        } else {
            fetchTransactions(branchFilter, p);
        }
    }, [isAM, branchFilter, fetchTransactions]);

    // AM: client-side filter + paginate over the full approval-queue array (unchanged behavior).
    const amFilteredRows = useMemo(() => {
        let result = amRows;
        if (activeTab === 'pending') result = result.filter((r) => r.approvalStatus === 'PENDING_APPROVAL');
        if (activeTab === 'approved') result = result.filter((r) => r.approvalStatus === 'APPROVED');
        if (activeTab === 'rejected') result = result.filter((r) => r.approvalStatus === 'REJECTED');
        if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            result = result.filter(
                (r) =>
                    r.voucherNo.toLowerCase().includes(q) ||
                    (r.ledger?.ledgerName ?? '').toLowerCase().includes(q) ||
                    (r.selfAccount?.name ?? '').toLowerCase().includes(q) ||
                    (r.description ?? '').toLowerCase().includes(q)
            );
        }
        return result;
    }, [amRows, activeTab, debouncedSearch]);

    const amTotalPages = Math.max(1, Math.ceil(amFilteredRows.length / PAGE_SIZE));
    const amPaginatedRows = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return amFilteredRows.slice(start, start + PAGE_SIZE);
    }, [amFilteredRows, page]);

    const transactions = isAM ? amPaginatedRows : serverRows;
    const displayTotalPages = isAM ? amTotalPages : totalPages;
    const displayTotalCount = isAM ? amFilteredRows.length : totalCount;

    // Export always covers the full filtered result set, not just the current page.
    const fetchExportRows = useCallback(async (): Promise<CashReceiptRow[]> => {
        if (isAM) return amFilteredRows;
        const params = new URLSearchParams({ fromDate, toDate, all: 'true' });
        if (branchFilter && branchFilter !== 'all') params.set('branchId', branchFilter);
        if (activeTab !== 'all') params.set('approvalStatus', TAB_APPROVAL_STATUS[activeTab]);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const res = await fetch(`/api/transactions/cash-receipt?${params.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed to fetch export data');
        return data.data.transactions ?? [];
    }, [isAM, amFilteredRows, fromDate, toDate, branchFilter, activeTab, debouncedSearch]);

    const buildExportTable = (list: CashReceiptRow[]) => {
        const headers = ['Voucher Date', 'Branch', 'Voucher No', 'Type', 'From Account', 'To Account', 'Amount', 'Created By', 'Status'];
        const rows = list.map((r) => [
            format(new Date(r.transactionDate), 'dd/MM/yyyy'),
            r.branch ? `${r.branch.code} - ${r.branch.name}` : '-',
            r.voucherNo,
            'Cash Receipt',
            r.ledger?.ledgerName || '-',
            r.selfAccount?.name || '-',
            Number(r.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : '-',
            r.approvalStatus || '-',
        ]);
        return { headers, rows };
    };

    const exportFileNameBase = `Cash_Receipt_${fromDate}_to_${toDate}`;

    const handleExportPDF = async () => {
        try {
            const list = await fetchExportRows();
            if (list.length === 0) {
                toast({ title: 'Nothing to Export', description: 'No transactions match the current filters.', variant: 'destructive' });
                return;
            }
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            const { headers, rows } = buildExportTable(list);
            const headerY = await drawPdfReportHeader(doc, 'CASH RECEIPT REPORT', {
                subtitle: `${fromDate} to ${toDate}`,
                fontFamily: reportFont,
            });
            autoTable(doc, {
                head: [headers],
                body: rows,
                startY: headerY,
                theme: 'grid',
                headStyles: { font: reportFont, fillColor: '#047857', textColor: '#ffffff', fontStyle: 'bold', halign: 'center' },
                styles: { font: reportFont, fontSize: 8, cellPadding: 2, textColor: '#000000' },
                columnStyles: { 6: { halign: 'right' } },
            });
            doc.save(`${exportFileNameBase}.pdf`);
            toast({ title: 'Export Successful', description: 'Cash receipts exported as PDF.', className: 'bg-emerald-50 border-emerald-200 text-emerald-800' });
        } catch (error: any) {
            toast({ title: 'Export Failed', description: error.message, variant: 'destructive' });
        }
    };

    const handleExportExcel = async () => {
        try {
            const list = await fetchExportRows();
            if (list.length === 0) {
                toast({ title: 'Nothing to Export', description: 'No transactions match the current filters.', variant: 'destructive' });
                return;
            }
            const { headers, rows } = buildExportTable(list);
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('CASH RECEIPT REPORT'), headers, ...rows]);
            autoSizeColumns(ws);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, `${exportFileNameBase}.xlsx`);
            toast({ title: 'Export Successful', description: 'Cash receipts exported as Excel.', className: 'bg-emerald-50 border-emerald-200 text-emerald-800' });
        } catch (error: any) {
            toast({ title: 'Export Failed', description: error.message, variant: 'destructive' });
        }
    };

    const handleSave = async (data: CashReceiptFormData) => {
        try {
            if (editingRow) {
                const res = await fetch(`/api/transactions/${editingRow.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transactionDate: data.transactionDate,
                        amount: parseFloat(data.amount),
                        debitAccountId: data.selfAccountId,
                        creditAccountId: data.ledgerId,
                        description: data.description,
                        originalType: 'CASH_RECEIPT',
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    throw new Error(result.message || 'Failed to update transaction');
                }
                toast({
                    title: 'Updated',
                    description: 'Cash Receipt updated successfully.',
                    className: "bg-emerald-50 border-emerald-200 text-emerald-800"
                });
                setEditingRow(null);
                await fetchTransactions(branchFilter, page);
                return true;
            }

            const payload = {
                ...data,
                amount: parseFloat(data.amount)
            };

            const res = await fetch('/api/transactions/cash-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.message || 'Failed to create transaction');
            }

            toast({
                title: 'Success',
                description: 'Cash Receipt created successfully.',
                className: "bg-emerald-50 border-emerald-200 text-emerald-800"
            });

            await fetchTransactions(branchFilter, 1);

            return true;
        } catch (error: any) {
            toast({
                title: editingRow ? 'Update Error' : 'Submission Error',
                description: error.message,
                variant: 'destructive'
            });
            return false;
        }
    };

    const handleEditRequest = (row: CashReceiptRow) => {
        setEditingRow(row);
        setTimeout(() => {
            document.getElementById('cash-receipt-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    const editData: CashReceiptEditData | null = editingRow ? {
        id: editingRow.id,
        voucherNo: editingRow.voucherNo,
        transactionDate: editingRow.transactionDate,
        branchId: editingRow.branch?.id ?? '',
        selfAccountId: editingRow.selfAccount?.id ?? '',
        ledgerId: editingRow.ledger?.id ?? '',
        amount: Number(editingRow.amount),
        description: editingRow.description,
    } : null;

    if (isLoading) {
        return <PageLoader label="Loading Cash Receipt Module..." />;
    }

    return (
        <div className="min-h-screen bg-background p-6 space-y-8">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                    <Wallet className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground dark:text-slate-50">
                        Cash Receipt
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Manage daily cash receipts (Debit: Cash Account, Credit: Ledger).
                    </p>
                </div>
            </div>

            {!isAM && (
                <CashReceiptForm
                    key={editingRow?.id ?? 'create'}
                    selfAccounts={selfAccounts}
                    ledgers={ledgers}
                    onSave={handleSave}
                    isDateEditable={isDateEditable}
                    editData={editData}
                    onCancelEdit={() => setEditingRow(null)}
                />
            )}

            <CashReceiptTable
                rows={transactions}
                onRefresh={() => fetchTransactions(branchFilter, page)}
                branchFilter={branchFilter}
                onBranchFilterChange={setBranchFilter}
                onEditRequest={handleEditRequest}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                fromDate={fromDate}
                onFromDateChange={setFromDate}
                toDate={toDate}
                onToDateChange={setToDate}
                page={page}
                totalPages={displayTotalPages}
                totalCount={displayTotalCount}
                onPageChange={handlePageChange}
                onExportPDF={handleExportPDF}
                onExportExcel={handleExportExcel}
            />
        </div>
    );
}
