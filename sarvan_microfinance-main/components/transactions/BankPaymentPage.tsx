'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { BankPaymentForm, BankPaymentFormData, BankPaymentEditData } from './BankPaymentForm';
import { BankPaymentTable, BankPaymentRow } from './BankPaymentTable';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { reportHeaderRows, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { PageLoader } from '@/components/ui/page-loader';

type ApiOk<T> = { success: true; data: T };
type ApiErr = { success: false; error: string };
type ApiRes<T> = ApiOk<T> | ApiErr;

type LedgerDto = { id: string; ledgerName?: string | null };
type SelfAccountDto = { id: string; name: string };
type BranchDto = { id: string; name: string; code: string };
type BranchOption = BranchDto;

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

export function BankPaymentPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [selfAccounts, setSelfAccounts] = useState<{ id: string; name: string }[]>([]);
    const [ledgers, setLedgers] = useState<{ id: string; name: string }[]>([]);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [branchFilter, setBranchFilter] = useState('all');
    const [editingRow, setEditingRow] = useState<BankPaymentRow | null>(null);

    const [sessionRole, setSessionRole] = useState<string | null>(null);
    const [activeBranchCode, setActiveBranchCode] = useState<string | null>(null);

    // Filters (moved up from BankPaymentTable so pagination/search/tab can be server-driven)
    const [activeTab, setActiveTab] = useState<ApprovalTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const initialRange = monthToDateRange();
    const [fromDate, setFromDate] = useState(initialRange.from);
    const [toDate, setToDate] = useState(initialRange.to);

    // Non-AM: server-paginated rows + metadata. AM: full unfiltered rows, paginated client-side.
    const [serverRows, setServerRows] = useState<BankPaymentRow[]>([]);
    const [amRows, setAmRows] = useState<BankPaymentRow[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        const u = tokenStorage.getUser();
        setSessionRole(u?.role ?? null);
        setActiveBranchCode(branchStorage.getActiveBranch()?.code ?? null);
    }, []);

    const isAdminHo = sessionRole === 'ADMIN' && activeBranchCode === 'HO';
    const isDateEditable = sessionRole === 'ADMIN';
    const isAM = sessionRole === 'AREA_MANAGER';

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    const fetchTransactions = useCallback(async (branchId: string, pageArg: number = 1) => {
        if (isAM) {
            const params = new URLSearchParams({ type: 'BANK_PAYMENT' });
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
        const txRes = await fetch(`/api/transactions/bank-payment?${params.toString()}`);
        const txData = (await txRes.json()) as ApiRes<{ transactions: BankPaymentRow[]; totalCount: number; totalPages: number; page: number }>;
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
        try {
            // Fetch Self Accounts, Ledgers, and Transactions in parallel
            const branchReq = isAdminHo ? fetch('/api/branches') : null;
            const [accRes, ledRes, branchesRes] = await Promise.all([
                fetch('/api/accounts/self?type=BANK'),
                fetch('/api/accounts/ledgers'),
                branchReq ?? Promise.resolve(null),
            ]);

            const accData = (await accRes.json()) as ApiRes<SelfAccountDto[]>;
            const ledData = (await ledRes.json()) as ApiRes<LedgerDto[]>;

            const accMsg = !accData.success ? accData.error : undefined;
            const ledMsg = !ledData.success ? ledData.error : undefined;

            if (!accRes.ok) throw new Error(accMsg || 'Failed to fetch self accounts');
            if (!ledRes.ok) throw new Error(ledMsg || 'Failed to fetch ledgers');

            setSelfAccounts((accData.success ? accData.data : []) ?? []);
            setLedgers(
                ((ledData.success ? ledData.data : []) ?? [])
                    .map((l) => ({ id: l.id, name: (l.ledgerName ?? '').toString() }))
                    .filter((l) => l.id && l.name)
            );
            await fetchTransactions(branchFilter, 1);

            if (branchesRes) {
                const brData = (await (branchesRes as Response).json()) as ApiRes<BranchDto[]>;
                const list = (brData.success ? brData.data : []) ?? [];
                setBranches(list.map((b) => ({ id: b.id, name: b.name, code: b.code })).filter((b) => b.code !== 'HO'));
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            toast({
                title: 'Data Load Error',
                description: error instanceof Error ? error.message : 'Failed to load initial data. Please refresh.',
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toast, isAdminHo, fetchTransactions]);

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminHo]);

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
                (row) =>
                    row.voucherNo.toLowerCase().includes(q) ||
                    (row.selfAccount?.name || '').toLowerCase().includes(q) ||
                    (row.ledger?.ledgerName || '').toLowerCase().includes(q) ||
                    (row.description || '').toLowerCase().includes(q)
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
    const fetchExportRows = useCallback(async (): Promise<BankPaymentRow[]> => {
        if (isAM) return amFilteredRows;
        const params = new URLSearchParams({ fromDate, toDate, all: 'true' });
        if (branchFilter && branchFilter !== 'all') params.set('branchId', branchFilter);
        if (activeTab !== 'all') params.set('approvalStatus', TAB_APPROVAL_STATUS[activeTab]);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const res = await fetch(`/api/transactions/bank-payment?${params.toString()}`);
        const data = (await res.json()) as ApiRes<{ transactions: BankPaymentRow[] }>;
        if (!data.success) throw new Error(data.error || 'Failed to fetch export data');
        return data.data.transactions ?? [];
    }, [isAM, amFilteredRows, fromDate, toDate, branchFilter, activeTab, debouncedSearch]);

    const buildExportTable = (list: BankPaymentRow[]) => {
        const headers = ['Voucher Date', 'Branch', 'Voucher No', 'Type', 'From Account', 'To Account', 'Amount', 'Created By', 'Status'];
        const rows = list.map((r) => [
            format(new Date(r.transactionDate), 'dd/MM/yyyy'),
            r.branch ? `${r.branch.code} - ${r.branch.name}` : '-',
            r.voucherNo,
            'Bank Payment',
            r.ledger?.ledgerName || '-',
            r.selfAccount?.name || '-',
            Number(r.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : '-',
            r.approvalStatus || '-',
        ]);
        return { headers, rows };
    };

    const exportFileNameBase = `Bank_Payment_${fromDate}_to_${toDate}`;

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
            const headerY = await drawPdfReportHeader(doc, 'BANK PAYMENT REPORT', {
                subtitle: `${fromDate} to ${toDate}`,
                fontFamily: reportFont,
            });
            autoTable(doc, {
                head: [headers],
                body: rows,
                startY: headerY,
                theme: 'grid',
                headStyles: { font: reportFont, fillColor: '#b91c1c', textColor: '#ffffff', fontStyle: 'bold', halign: 'center' },
                styles: { font: reportFont, fontSize: 8, cellPadding: 2, textColor: '#000000' },
                columnStyles: { 6: { halign: 'right' } },
            });
            doc.save(`${exportFileNameBase}.pdf`);
            toast({ title: 'Export Successful', description: 'Bank payments exported as PDF.' });
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
            const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('BANK PAYMENT REPORT'), headers, ...rows]);
            autoSizeColumns(ws);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, `${exportFileNameBase}.xlsx`);
            toast({ title: 'Export Successful', description: 'Bank payments exported as Excel.' });
        } catch (error) {
            toast({ title: 'Export Failed', description: error instanceof Error ? error.message : 'Unexpected error', variant: 'destructive' });
        }
    };

    const handleSave = async (data: BankPaymentFormData) => {
        try {
            if (editingRow) {
                // Editing always PUTs to the generic route — never the inter-branch-transfer path,
                // regardless of isAdminHo (the form hides the HO Remittance field while editing).
                const res = await fetch(`/api/transactions/${editingRow.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transactionDate: data.transactionDate,
                        amount: parseFloat(data.amount),
                        debitAccountId: data.ledgerId,
                        creditAccountId: data.selfAccountId,
                        description: data.description,
                        originalType: 'BANK_PAYMENT',
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    throw new Error(result.message || 'Failed to update transaction');
                }
                toast({
                    title: 'Updated',
                    description: 'Bank Payment updated successfully.',
                });
                setEditingRow(null);
                await fetchTransactions(branchFilter, page);
                return true;
            }

            if (isAdminHo && data.toBranchId) {
                const res = await fetch('/api/transactions/inter-branch-transfer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        toBranchId: data.toBranchId,
                        mode: 'BANK',
                        selfAccountId: data.selfAccountId,
                        amount: parseFloat(data.amount),
                        transferDate: new Date(data.transactionDate).toISOString(),
                        narration: data.description?.trim() || undefined,
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    throw new Error(result.error || result.message || 'Failed to post HO remittance');
                }
                toast({
                    title: 'Success',
                    description: result.message || 'HO remittance posted successfully.',
                });
                await fetchTransactions(branchFilter, 1);
                return true;
            }

            const payload = {
                ...data,
                amount: parseFloat(data.amount)
            };

            const res = await fetch('/api/transactions/bank-payment', {
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
                description: `Bank Payment ${result.data.voucherNo} created successfully.`
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

    const handleEditRequest = (row: BankPaymentRow) => {
        setEditingRow(row);
        setTimeout(() => {
            document.getElementById('bank-payment-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    const editData: BankPaymentEditData | null = editingRow ? {
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
        return <PageLoader label="Loading Bank Payment Module..." />;
    }

    return (
        <div className="space-y-8 p-1">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Bank Payment
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Manage day-to-day bank payment transactions (Debit: Ledger, Credit: Bank).
                </p>
            </div>

            {!isAM && (
                <BankPaymentForm
                    key={editingRow?.id ?? 'create'}
                    selfAccounts={selfAccounts}
                    ledgers={ledgers}
                    onSave={handleSave}
                    isDateEditable={isDateEditable}
                    isAdminHo={isAdminHo}
                    branches={branches}
                    editData={editData}
                    onCancelEdit={() => setEditingRow(null)}
                />
            )}

            <BankPaymentTable
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
