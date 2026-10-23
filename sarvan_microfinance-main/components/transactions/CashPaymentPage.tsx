'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { CashPaymentForm, CashPaymentFormData, CashPaymentEditData } from '@/components/transactions/CashPaymentForm';
import { CashPaymentTable, CashPaymentRow } from '@/components/transactions/CashPaymentTable';
import { Wallet } from 'lucide-react';
import { tokenStorage } from '@/app/lib/token-storage';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { reportHeaderRows, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { PageLoader } from '@/components/ui/page-loader';

type ApiOk<T> = { success: true; data: T };
type ApiErr = { success: false; error: string };
type ApiRes<T> = ApiOk<T> | ApiErr;

type LedgerDto = { id: string; ledgerName?: string | null; name?: string | null };
type SelfAccountDto = { id: string; name: string };

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

export function CashPaymentPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [selfAccounts, setSelfAccounts] = useState<{ id: string; name: string }[]>([]);
    const [ledgers, setLedgers] = useState<{ id: string; name: string }[]>([]);
    const [branchFilter, setBranchFilter] = useState('all');
    const [editingRow, setEditingRow] = useState<CashPaymentRow | null>(null);

    const [sessionRole, setSessionRole] = useState<string | null>(null);

    useEffect(() => {
        const u = tokenStorage.getUser();
        setSessionRole(u?.role ?? null);
    }, []);

    const isDateEditable = sessionRole === 'ADMIN';
    const isAM = sessionRole === 'AREA_MANAGER';

    // Filters (moved up from CashPaymentTable so pagination/search/tab can be server-driven)
    const [activeTab, setActiveTab] = useState<ApprovalTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const initialRange = monthToDateRange();
    const [fromDate, setFromDate] = useState(initialRange.from);
    const [toDate, setToDate] = useState(initialRange.to);

    // Non-AM: server-paginated rows + metadata. AM: full unfiltered rows, paginated client-side.
    const [serverRows, setServerRows] = useState<CashPaymentRow[]>([]);
    const [amRows, setAmRows] = useState<CashPaymentRow[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    const fetchTransactions = useCallback(async (branchId: string, pageArg: number = 1) => {
        if (isAM) {
            const params = new URLSearchParams({ type: 'CASH_PAYMENT' });
            if (branchId && branchId !== 'all') params.set('branchId', branchId);
            const txRes = await fetch(`/api/transactions/approval?${params.toString()}`);
            const txData = await txRes.json();
            setAmRows((txData.success ? txData.data?.transactions : []) ?? []);
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
        const txRes = await fetch(`/api/transactions/cash-payment?${params.toString()}`);
        const txData = (await txRes.json()) as ApiRes<{ transactions: CashPaymentRow[]; totalCount: number; totalPages: number; page: number }>;
        if (txData.success) {
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

            const accData = (await accRes.json()) as ApiRes<SelfAccountDto[]>;
            const ledData = (await ledRes.json()) as ApiRes<LedgerDto[]>;

            setSelfAccounts((accData.success ? accData.data : []) ?? []);
            const rawLedgers = (ledData.success ? ledData.data : []) ?? [];
            setLedgers(
                rawLedgers.map((l) => ({
                    id: l.id,
                    name: (l.ledgerName ?? l.name ?? '').toString(),
                })).filter((l) => l.id && l.name)
            );
            await fetchTransactions(branchFilter, 1);

        } catch (error) {
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
    const fetchExportRows = useCallback(async (): Promise<CashPaymentRow[]> => {
        if (isAM) return amFilteredRows;
        const params = new URLSearchParams({ fromDate, toDate, all: 'true' });
        if (branchFilter && branchFilter !== 'all') params.set('branchId', branchFilter);
        if (activeTab !== 'all') params.set('approvalStatus', TAB_APPROVAL_STATUS[activeTab]);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const res = await fetch(`/api/transactions/cash-payment?${params.toString()}`);
        const data = (await res.json()) as ApiRes<{ transactions: CashPaymentRow[] }>;
        if (!data.success) throw new Error(data.error || 'Failed to fetch export data');
        return data.data.transactions ?? [];
    }, [isAM, amFilteredRows, fromDate, toDate, branchFilter, activeTab, debouncedSearch]);

    const buildExportTable = (list: CashPaymentRow[]) => {
        const headers = ['Voucher Date', 'Branch', 'Voucher No', 'Type', 'From Account', 'To Account', 'Amount', 'Created By', 'Status'];
        const rows = list.map((r) => [
            format(new Date(r.transactionDate), 'dd/MM/yyyy'),
            r.branch ? `${r.branch.code} - ${r.branch.name}` : '-',
            r.voucherNo,
            'Cash Payment',
            r.ledger?.ledgerName || '-',
            r.selfAccount?.name || '-',
            Number(r.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : '-',
            r.approvalStatus || '-',
        ]);
        return { headers, rows };
    };

    const exportFileNameBase = `Cash_Payment_${fromDate}_to_${toDate}`;

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
            const headerY = await drawPdfReportHeader(doc, 'CASH PAYMENT REPORT', {
                subtitle: `${fromDate} to ${toDate}`,
                fontFamily: reportFont,
            });
            autoTable(doc, {
                head: [headers],
                body: rows,
                startY: headerY,
                theme: 'grid',
                headStyles: { font: reportFont, fillColor: '#b45309', textColor: '#ffffff', fontStyle: 'bold', halign: 'center' },
                styles: { font: reportFont, fontSize: 8, cellPadding: 2, textColor: '#000000' },
                columnStyles: { 6: { halign: 'right' } },
            });
            doc.save(`${exportFileNameBase}.pdf`);
            toast({ title: 'Export Successful', description: 'Cash payments exported as PDF.', className: 'bg-amber-50 border-amber-200 text-amber-800' });
        } catch (error) {
            toast({ title: 'Export Failed', description: error instanceof Error ? error.message : 'Unexpected error', variant: 'destructive' });
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
            const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('CASH PAYMENT REPORT'), headers, ...rows]);
            autoSizeColumns(ws);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, `${exportFileNameBase}.xlsx`);
            toast({ title: 'Export Successful', description: 'Cash payments exported as Excel.', className: 'bg-amber-50 border-amber-200 text-amber-800' });
        } catch (error) {
            toast({ title: 'Export Failed', description: error instanceof Error ? error.message : 'Unexpected error', variant: 'destructive' });
        }
    };

    const handleSave = async (data: CashPaymentFormData) => {
        try {
            if (editingRow) {
                const res = await fetch(`/api/transactions/${editingRow.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transactionDate: data.transactionDate,
                        amount: parseFloat(data.amount),
                        debitAccountId: data.ledgerId,
                        creditAccountId: data.selfAccountId,
                        description: data.description,
                        originalType: 'CASH_PAYMENT',
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    throw new Error(result.message || 'Failed to update transaction');
                }
                toast({
                    title: 'Updated',
                    description: 'Cash Payment updated successfully.',
                    className: "bg-amber-50 border-amber-200 text-amber-800"
                });
                setEditingRow(null);
                await fetchTransactions(branchFilter, page);
                return true;
            }

            const payload = {
                transactionDate: data.transactionDate,
                branchId: data.branchId,
                ledgerId: data.ledgerId,
                selfAccountId: data.selfAccountId,
                amount: parseFloat(data.amount),
                description: data.description,
            };

            const res = await fetch('/api/transactions/cash-payment', {
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
                description: 'Cash Payment created successfully.',
                className: "bg-amber-50 border-amber-200 text-amber-800"
            });

            await fetchTransactions(branchFilter, 1);

            return true;
        } catch (error) {
            toast({
                title: editingRow ? 'Update Error' : 'Submission Error',
                description: error instanceof Error ? error.message : 'Unexpected error',
                variant: 'destructive'
            });
            return false;
        }
    };

    const handleEditRequest = (row: CashPaymentRow) => {
        setEditingRow(row);
        setTimeout(() => {
            document.getElementById('cash-payment-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    const editData: CashPaymentEditData | null = editingRow ? {
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
        return <PageLoader label="Loading Cash Payment Module..." />;
    }

    return (
        <div className="min-h-screen bg-background p-6 space-y-8">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                    <Wallet className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground dark:text-slate-50">
                        Cash Payment
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Manage day-to-day cash payments (Debit: Ledger, Credit: Cash).
                    </p>
                </div>
            </div>

            {!isAM && (
                <CashPaymentForm
                    key={editingRow?.id ?? 'create'}
                    selfAccounts={selfAccounts}
                    ledgers={ledgers}
                    onSave={handleSave}
                    isDateEditable={isDateEditable}
                    editData={editData}
                    onCancelEdit={() => setEditingRow(null)}
                />
            )}

            <CashPaymentTable
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
