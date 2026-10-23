'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
    CalendarDays, Save, Trash2, RefreshCw, IndianRupee,
    BookOpen, Search, ChevronLeft, ChevronRight,
    ChevronsLeft, ChevronsRight, Calendar, BookMarked,
    Check, ChevronsUpDown, Printer, CheckCircle, Lock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { format } from 'date-fns';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { tokenStorage } from '@/app/lib/token-storage';
import { TransactionApprovalModal, TransactionModalRow } from './TransactionApprovalModal';
import { TransactionBranchFilter } from './TransactionBranchFilter';
import { TransactionBranchField } from './TransactionBranchField';
import { JournalPrint, JournalPrintData } from './JournalPrint';
import { stripPostingMarker } from '@/app/lib/narration';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { reportHeaderRows, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
function JournalApprovalBadge({ status, reason }: { status?: string; reason?: string }) {
    const config: Record<string, { label: string; className: string }> = {
        PENDING_AM_APPROVAL: { label: 'Pending AM', className: 'bg-amber-100 text-amber-700 border-amber-200' },
        PENDING_ADMIN_APPROVAL: { label: 'Pending Admin', className: 'bg-brand-green-tint text-sidebar-accent border-primary/30' },
        APPROVED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-700 border-red-200' },
        REVERTED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    };
    const c = config[status ?? ''] ?? { label: status ?? '—', className: 'bg-gray-100 text-gray-600' };
    return (
        <Badge variant="outline" className={`text-xs ${c.className}`}
            title={status === 'REJECTED' && reason ? `Reason: ${reason}` : undefined}>
            {c.label}
        </Badge>
    );
}

interface Ledger {
    id: string;
    ledgerName: string;
}

interface JournalTransaction {
    id: string;
    voucherNo: string;
    transactionDate: string;
    ledger: { id: string; ledgerName: string } | null;
    creditLedger: { id: string; ledgerName: string } | null;
    amount: number | string;
    description?: string;
    createdBy: { firstName: string; lastName: string };
    approvalStatus?: string;
    rejectionReason?: string;
    rejectedBy?: { firstName: string; lastName: string };
    rejectedAt?: string;
    revertReason?: string;
    revertedBy?: { firstName: string; lastName: string };
    revertedAt?: string;
    branch?: { id: string; code: string; name: string } | null;
    canModify?: boolean;
    eodLocked?: boolean;
}

interface FormState {
    voucherDate: string;
    branchId: string;
    debitLedgerId: string;
    creditLedgerId: string;
    amount: string;
    narration: string;
}

const EMPTY_FORM: FormState = {
    voucherDate: '',
    branchId: '',
    debitLedgerId: '',
    creditLedgerId: '',
    amount: '',
    narration: '',
};

const fmtAmount = (v: number | string) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));

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

function SearchableSelect({
    options,
    value,
    onValueChange,
    placeholder,
    disabled,
    excludeId
}: {
    options: Ledger[],
    value: string,
    onValueChange: (v: string) => void,
    placeholder: string,
    disabled?: boolean,
    excludeId?: string
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const filteredOptions = useMemo(() => {
        return options.filter(opt =>
            opt.id !== excludeId &&
            opt.ledgerName.toLowerCase().includes(search.toLowerCase())
        );
    }, [options, search, excludeId]);

    const selectedName = options.find(o => o.id === value)?.ledgerName;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between h-10 border-primary/30 dark:border-sidebar-accent font-normal"
                    disabled={disabled}
                >
                    <span className="truncate">
                        {selectedName || placeholder}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <div className="flex items-center border-b px-3 dark:border-sidebar-accent">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    <input
                        className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-50"
                        placeholder="Search ledger..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <ScrollArea className="h-[300px]">
                    <div className="p-1">
                        {filteredOptions.length === 0 ? (
                            <div className="py-6 text-center text-sm text-slate-500">No ledger found.</div>
                        ) : (
                            filteredOptions.map((opt) => (
                                <div
                                    key={opt.id}
                                    className={cn(
                                        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-brand-green-tint dark:hover:bg-sidebar-accent",
                                        value === opt.id && "bg-brand-green-tint dark:bg-sidebar-accent font-medium text-violet-600"
                                    )}
                                    onClick={() => {
                                        onValueChange(opt.id);
                                        setOpen(false);
                                        setSearch("");
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === opt.id ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    {opt.ledgerName}
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}

export function JournalVoucher() {
    const { toast } = useToast();
    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const [nextVoucherNo, setNextVoucherNo] = useState('Auto');
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const initialRange = monthToDateRange();
    const [fromDate, setFromDate] = useState(initialRange.from);
    const [toDate, setToDate] = useState(initialRange.to);
    const [activeTab, setActiveTab] = useState<ApprovalTab>('all');
    const [branchFilter, setBranchFilter] = useState('all');

    // Non-AM: server-paginated rows + metadata. AM: full unfiltered rows, paginated client-side.
    const [serverRows, setServerRows] = useState<JournalTransaction[]>([]);
    const [amRows, setAmRows] = useState<JournalTransaction[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    const [role, setRole] = useState<string | null>(null);
    const [assignedBranchIds, setAssignedBranchIds] = useState<string[]>([]);
    const [isSubAdmin, setIsSubAdmin] = useState(false);
    useEffect(() => {
        const user = tokenStorage.getUser();
        setRole(user?.role ?? null);
        setAssignedBranchIds((user as any)?.assignedBranchIds ?? []);
        setIsSubAdmin(!!user?.isSubAdmin);
    }, []);
    const isAdmin = role === 'ADMIN';
    const isBM = role === 'BRANCH_MANAGER';
    const isAM = role === 'AREA_MANAGER';

    // AM: client-side filter + paginate over the full approval-queue array (unchanged behavior).
    const amFilteredRows = useMemo(() => {
        let result = amRows;
        if (activeTab === 'pending') result = result.filter(tx => tx.approvalStatus === 'PENDING_APPROVAL');
        if (activeTab === 'approved') result = result.filter(tx => tx.approvalStatus === 'APPROVED');
        if (activeTab === 'rejected') result = result.filter(tx => tx.approvalStatus === 'REJECTED');
        if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            result = result.filter(tx =>
                tx.voucherNo.toLowerCase().includes(q) ||
                (tx.ledger?.ledgerName ?? '').toLowerCase().includes(q) ||
                (tx.creditLedger?.ledgerName ?? '').toLowerCase().includes(q) ||
                (tx.description ?? '').toLowerCase().includes(q)
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
    const fetchExportRows = useCallback(async (): Promise<JournalTransaction[]> => {
        if (isAM) return amFilteredRows;
        const params = new URLSearchParams({ fromDate, toDate, all: 'true' });
        if (branchFilter && branchFilter !== 'all') params.set('branchId', branchFilter);
        if (activeTab !== 'all') params.set('approvalStatus', TAB_APPROVAL_STATUS[activeTab]);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const res = await apiClient.get<any>(`/transactions/journal?${params.toString()}`);
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to fetch export data');
        return res.data.transactions || [];
    }, [isAM, amFilteredRows, fromDate, toDate, branchFilter, activeTab, debouncedSearch]);

    const buildExportTable = (list: JournalTransaction[]) => {
        const headers = ['Voucher Date', 'Branch', 'Voucher No', 'Debit Account', 'Credit Account', 'Amount', 'Narration', 'Created By', 'Status'];
        const rows = list.map((tx) => [
            format(new Date(tx.transactionDate), 'dd/MM/yyyy'),
            tx.branch ? `${tx.branch.code} - ${tx.branch.name}` : '-',
            tx.voucherNo,
            tx.ledger?.ledgerName || '-',
            tx.creditLedger?.ledgerName || '-',
            fmtAmount(tx.amount),
            stripPostingMarker(tx.description) || '-',
            `${tx.createdBy?.firstName ?? ''} ${tx.createdBy?.lastName ?? ''}`.trim() || '-',
            tx.approvalStatus || '-',
        ]);
        return { headers, rows };
    };

    const exportFileNameBase = `Journal_Voucher_${fromDate}_to_${toDate}`;

    const handleExportPDF = async () => {
        try {
            const list = await fetchExportRows();
            if (list.length === 0) {
                toast({ variant: 'destructive', title: 'Nothing to Export', description: 'No vouchers match the current filters.' });
                return;
            }
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            const { headers, rows } = buildExportTable(list);
            const headerY = await drawPdfReportHeader(doc, 'JOURNAL VOUCHER REPORT', {
                subtitle: `${fromDate} to ${toDate}`,
                fontFamily: reportFont,
            });
            autoTable(doc, {
                head: [headers],
                body: rows,
                startY: headerY,
                theme: 'grid',
                headStyles: { font: reportFont, fillColor: '#6d28d9', textColor: '#ffffff', fontStyle: 'bold', halign: 'center' },
                styles: { font: reportFont, fontSize: 8, cellPadding: 2, textColor: '#000000' },
                columnStyles: { 5: { halign: 'right' } },
            });
            doc.save(`${exportFileNameBase}.pdf`);
            toast({ title: 'Export Successful', description: 'Journal vouchers exported as PDF.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Export Failed', description: err.message });
        }
    };

    const handleExportExcel = async () => {
        try {
            const list = await fetchExportRows();
            if (list.length === 0) {
                toast({ variant: 'destructive', title: 'Nothing to Export', description: 'No vouchers match the current filters.' });
                return;
            }
            const { headers, rows } = buildExportTable(list);
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('JOURNAL VOUCHER REPORT'), headers, ...rows]);
            autoSizeColumns(ws);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, `${exportFileNameBase}.xlsx`);
            toast({ title: 'Export Successful', description: 'Journal vouchers exported as Excel.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Export Failed', description: err.message });
        }
    };

    // Approval modal
    const [modalRow, setModalRow] = useState<JournalTransaction | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const canActOnRow = (tx: JournalTransaction) => {
        if (isAdmin || isSubAdmin) return true;
        if (isAM) return !tx.branch?.id || assignedBranchIds.includes(tx.branch.id);
        return false;
    };
    const openChecker = (tx: JournalTransaction) => {
        setModalRow(tx);
        setModalOpen(true);
    };

    const selectedTx = selectedId ? transactions.find(t => t.id === selectedId) ?? null : null;
    // Update is blocked on APPROVED rows (the backend PUT itself 409s) — Delete intentionally
    // ignores approval status, matching Cash Payment's existing "delete ignores approval" rule.
    const canEditSelectedRow = (isAdmin || isSubAdmin) && !!selectedTx
        && selectedTx.approvalStatus !== 'APPROVED' && selectedTx.canModify !== false;
    const canDeleteSelectedRow = (isAdmin || isSubAdmin) && !!selectedTx && selectedTx.canModify !== false;

    // Printing
    const printRef = useRef<HTMLDivElement>(null);
    const [printData, setPrintData] = useState<JournalPrintData | null>(null);
    const [printBranch, setPrintBranch] = useState<{ code: string; name: string } | null>(null);
    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Journal_Voucher_${printData?.voucherNo || 'System'}`,
    });
    const triggerPrint = (tx: JournalTransaction) => {
        setPrintData({
            voucherNo: tx.voucherNo,
            transactionDate: tx.transactionDate,
            debitAccountName: tx.ledger?.ledgerName || '—',
            creditAccountName: tx.creditLedger?.ledgerName || '—',
            narration: tx.description,
            amount: Number(tx.amount),
        });
        setPrintBranch(tx.branch ? { code: tx.branch.code, name: tx.branch.name } : null);
        setTimeout(() => handlePrint(), 100);
    };

    // Get EOD working date from API — scoped to the form's own branch field so switching
    // branch re-resolves the correct branch's EOD working date instead of staying pinned to
    // the session-active branch.
    const { eodWorkingDate, isLoading: isEodLoading } = useEodWorkingDate(form.branchId);

    // Update form with EOD working date when it loads
    useEffect(() => {
        if (eodWorkingDate && /^\d{4}-\d{2}-\d{2}$/.test(eodWorkingDate) && !selectedId) {
            setForm(prev => ({
                ...prev,
                voucherDate: eodWorkingDate,
            }));
        }
    }, [eodWorkingDate, selectedId]);

    const journalEndpoint = useCallback((branchId: string, pageArg: number = 1) => {
        if (isAM) {
            const params = new URLSearchParams({ type: 'JOURNAL' });
            if (branchId && branchId !== 'all') params.set('branchId', branchId);
            return `/transactions/approval?${params.toString()}`;
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
        return `/transactions/journal?${params.toString()}`;
    }, [isAM, fromDate, toDate, activeTab, debouncedSearch]);

    const fetchAll = useCallback(async (pageArg: number = 1) => {
        try {
            const [ledRes, txRes] = await Promise.all([
                apiClient.get<any[]>('/accounts/ledgers'),
                apiClient.get<any>(journalEndpoint(branchFilter, pageArg)),
            ]);

            if (ledRes.success && ledRes.data) {
                setLedgers(ledRes.data.map((l: any) => ({ id: l.id, ledgerName: l.ledgerName })));
            }
            if (txRes.success && txRes.data) {
                if (isAM) {
                    setAmRows(txRes.data.transactions || []);
                    setPage(pageArg);
                } else {
                    setServerRows(txRes.data.transactions || []);
                    setTotalPages(txRes.data.totalPages || 1);
                    setTotalCount(txRes.data.totalCount ?? 0);
                    setPage(txRes.data.page ?? pageArg);
                }
                if (!selectedId) setNextVoucherNo(txRes.data.nextVoucherNo || 'Auto');
            }
        } catch {
            toast({ variant: 'destructive', title: 'Load Error', description: 'Failed to load data. Please refresh.' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast, selectedId, branchFilter, journalEndpoint, isAM]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const handlePageChange = (p: number) => {
        if (isAM) {
            setPage(p);
        } else {
            fetchAll(p);
        }
    };

    const refreshTransactions = async (pageArg: number = page) => {
        const res = await apiClient.get<any>(journalEndpoint(branchFilter, pageArg));
        if (res.success && res.data) {
            if (isAM) {
                setAmRows(res.data.transactions || []);
                setPage(pageArg);
            } else {
                setServerRows(res.data.transactions || []);
                setTotalPages(res.data.totalPages || 1);
                setTotalCount(res.data.totalCount ?? 0);
                setPage(res.data.page ?? pageArg);
            }
            if (!selectedId) setNextVoucherNo(res.data.nextVoucherNo || 'Auto');
        }
    };

    const setField = (field: keyof FormState, value: string) =>
        setForm(prev => ({ ...prev, [field]: value }));

    const handleReset = () => {
        const resetDate = eodWorkingDate || new Date().toISOString().split('T')[0];
        setForm({
            ...EMPTY_FORM,
            voucherDate: resetDate,
        });
        setSelectedId(null);
        setNextVoucherNo('Auto');
    };

    const handleRowClick = (tx: JournalTransaction) => {
        setSelectedId(tx.id);
        setForm({
            voucherDate: tx.transactionDate.split('T')[0],
            branchId: tx.branch?.id ?? '',
            debitLedgerId: tx.ledger?.id ?? '',
            creditLedgerId: tx.creditLedger?.id ?? '',
            amount: String(Number(tx.amount)),
            narration: tx.description ?? '',
        });
        setNextVoucherNo(tx.voucherNo);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!form.voucherDate) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Voucher date is required.' });
            return;
        }
        if (!form.branchId) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select a branch.' });
            return;
        }
        const parsedAmount = parseFloat(form.amount);
        if (!form.amount || isNaN(parsedAmount) || parsedAmount <= 0) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Enter a valid positive amount.' });
            return;
        }
        if (!form.debitLedgerId) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select a Debit account.' });
            return;
        }
        if (!form.creditLedgerId) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select a Credit account.' });
            return;
        }
        if (form.debitLedgerId === form.creditLedgerId) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Debit and Credit accounts must be different.' });
            return;
        }
        if (!form.narration.trim()) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Narration is required.' });
            return;
        }

        setIsSaving(true);
        try {
            if (selectedId) {
                toast({ title: 'Updating...', description: 'Updating journal voucher.' });
                const result = await apiClient.put<any>(`/transactions/${selectedId}`, {
                    transactionDate: form.voucherDate,
                    amount: parsedAmount,
                    debitAccountId: form.debitLedgerId,
                    creditAccountId: form.creditLedgerId,
                    description: form.narration.trim(),
                    originalType: 'JOURNAL',
                });
                if (!result.success) throw new Error(result.error || 'Failed to update');

                toast({ title: 'Voucher Updated', description: `Journal voucher ${nextVoucherNo} updated successfully.` });
                handleReset();
                await refreshTransactions();
                return;
            }

            toast({ title: 'Saving...', description: 'Creating journal voucher.' });
            const result = await apiClient.post<any>('/transactions/journal', {
                transactionDate: form.voucherDate,
                branchId: form.branchId,
                debitLedgerId: form.debitLedgerId,
                creditLedgerId: form.creditLedgerId,
                amount: parsedAmount,
                description: form.narration.trim(),
            });
            if (!result.success) throw new Error(result.error || 'Failed to save');

            toast({ title: 'Voucher Saved', description: `Journal voucher ${result.data?.voucherNo} created successfully.` });
            handleReset();
            await refreshTransactions(1);
        } catch (err: any) {
            toast({ variant: 'destructive', title: selectedId ? 'Update Failed' : 'Save Failed', description: err.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedId) {
            toast({ variant: 'destructive', title: 'No Selection', description: 'Select a voucher from the table to delete.' });
            return;
        }
        if (!canDeleteSelectedRow) {
            toast({ variant: 'destructive', title: 'Not Allowed', description: 'You do not have permission to delete this voucher.' });
            return;
        }
        setIsDeleting(true);
        toast({ title: 'Deleting...', description: `Removing voucher ${nextVoucherNo}.` });
        try {
            const result = await apiClient.delete<any>(`/transactions/journal?id=${selectedId}`);
            if (!result.success) throw new Error(result.error || 'Failed to delete');

            toast({ title: 'Voucher Deleted', description: `Voucher ${nextVoucherNo} has been removed.` });
            handleReset();
            await refreshTransactions();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Delete Failed', description: err.message });
        } finally {
            setIsDeleting(false);
        }
    };

    const isDisabled = isSaving || isDeleting;

    // Show loading state
    if (isInitialLoading || isEodLoading) {
        return (
            <PageLoader label={isEodLoading ? 'Loading EOD working date...' : 'Loading Journal Voucher Module...'} />
        );
    }

    return (
        <div className="space-y-8 px-3 sm:px-6 py-4 sm:py-8">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Journal Voucher
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Record journal entries between ledger accounts (both sides are account ledgers).
                </p>
                {eodWorkingDate && (
                    <p className="text-xs text-violet-600 dark:text-violet-400 mt-2">
                        Using EOD working date: {format(new Date(eodWorkingDate), 'dd/MM/yyyy')}
                    </p>
                )}
            </div>

            {/* Entry Form */}
            {!isAM && (
            <Card className="border-2 border-primary/20 dark:border-sidebar-accent shadow-lg overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-violet-600 via-purple-600 to-primary" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-violet-50/60 to-purple-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 shadow-lg shadow-violet-500/30">
                            <BookOpen className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-semibold text-foreground dark:text-white">
                                Voucher Entry — Journal
                            </CardTitle>
                            <CardDescription>
                                {selectedId
                                    ? `${canEditSelectedRow ? 'Editing' : 'Viewing'}: ${nextVoucherNo}`
                                    : 'New journal entry — auto-generates voucher number'}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <form onSubmit={handleSave} className="space-y-6">
                        {/* Row 1: Branch, Date, Voucher No, Amount */}
                        <div className="grid gap-6 md:grid-cols-4">
                            <TransactionBranchField
                                value={form.branchId}
                                onChange={(branchId) => setField('branchId', branchId)}
                                disabled={isDisabled || !!selectedId}
                            />

                            <div className="space-y-2">
                                <Label htmlFor="voucherDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Voucher Date <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <DateInput
                                        id="voucherDate"
                                        value={form.voucherDate}
                                        onChange={e => setField('voucherDate', e.target.value)}
                                        className="h-10 pr-9 border-primary/30 dark:border-sidebar-accent"
                                        disabled={isDisabled || (!!selectedId && !canEditSelectedRow)}
                                    />
                                </div>
                                {eodWorkingDate && !selectedId && (
                                    <p className="text-xs text-slate-500 mt-1">
                                        Based on EOD working date: {format(new Date(eodWorkingDate), 'dd/MM/yyyy')}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="voucherNo" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Voucher No
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="voucherNo"
                                        value={nextVoucherNo}
                                        readOnly
                                        className="h-10 bg-brand-green-tint dark:bg-sidebar-accent cursor-not-allowed border-primary/30 dark:border-sidebar-accent font-mono"
                                    />
                                    <Badge variant="secondary" className="text-xs shrink-0">Auto</Badge>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="amount" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-1">
                                    <IndianRupee className="h-3.5 w-3.5" />
                                    Amount <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="amount"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={form.amount}
                                    onChange={e => setField('amount', e.target.value)}
                                    className="h-10 border-primary/30 dark:border-sidebar-accent"
                                    placeholder="0.00"
                                    disabled={isDisabled || (!!selectedId && !canEditSelectedRow)}
                                />
                            </div>
                        </div>

                        {/* Row 2: Debit, Credit, Narration */}
                        <div className="grid gap-6 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label htmlFor="debitLedger" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Debit <span className="text-red-500">*</span>
                                </Label>
                                <SearchableSelect
                                    options={ledgers}
                                    value={form.debitLedgerId}
                                    onValueChange={v => setField('debitLedgerId', v)}
                                    placeholder="-- SELECT --"
                                    disabled={isDisabled || (!!selectedId && !canEditSelectedRow)}
                                    excludeId={form.creditLedgerId}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="creditLedger" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Credit <span className="text-red-500">*</span>
                                </Label>
                                <SearchableSelect
                                    options={ledgers}
                                    value={form.creditLedgerId}
                                    onValueChange={v => setField('creditLedgerId', v)}
                                    placeholder="-- SELECT --"
                                    disabled={isDisabled || (!!selectedId && !canEditSelectedRow)}
                                    excludeId={form.debitLedgerId}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="narration" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Narration <span className="text-red-500">*</span>
                                </Label>
                                <Textarea
                                    id="narration"
                                    value={form.narration}
                                    onChange={e => setField('narration', e.target.value)}
                                    className="min-h-[40px] h-10 border-primary/30 dark:border-sidebar-accent resize-none"
                                    placeholder="Enter description..."
                                    disabled={isDisabled || (!!selectedId && !canEditSelectedRow)}
                                />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center gap-3 border-t border-primary/20 dark:border-sidebar-accent pt-5">
                            {!selectedId && (
                                <Button
                                    type="submit"
                                    disabled={isDisabled}
                                    className="h-10 gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-sm"
                                >
                                    {isSaving ? (
                                        <><RefreshCw className="h-4 w-4 animate-spin" />Saving...</>
                                    ) : (
                                        <><Save className="h-4 w-4" />Save</>
                                    )}
                                </Button>
                            )}

                            {selectedId && canEditSelectedRow && (
                                <Button
                                    type="submit"
                                    disabled={isDisabled}
                                    className="h-10 gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-sm"
                                >
                                    {isSaving ? (
                                        <><RefreshCw className="h-4 w-4 animate-spin" />Updating...</>
                                    ) : (
                                        <><Save className="h-4 w-4" />Update</>
                                    )}
                                </Button>
                            )}

                            {selectedId && canDeleteSelectedRow && (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={handleDelete}
                                    disabled={isDisabled}
                                    className="h-10 gap-2"
                                >
                                    {isDeleting ? (
                                        <><RefreshCw className="h-4 w-4 animate-spin" />Deleting...</>
                                    ) : (
                                        <><Trash2 className="h-4 w-4" />Delete</>
                                    )}
                                </Button>
                            )}

                            {selectedId && (isAdmin || isSubAdmin) && !canEditSelectedRow && selectedTx?.approvalStatus === 'APPROVED' && (
                                <Badge variant="outline" className="text-xs gap-1 bg-slate-100 text-slate-600 border-slate-200 whitespace-nowrap" title="Revert the transaction to enable editing">
                                    <Lock className="h-3 w-3" /> Approved — revert to edit
                                </Badge>
                            )}
                            {selectedId && (isAdmin || isSubAdmin) && !canEditSelectedRow && selectedTx?.canModify === false && selectedTx?.approvalStatus !== 'APPROVED' && (
                                <Badge variant="outline" className="text-xs gap-1 bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap">
                                    <Lock className="h-3 w-3" /> EOD completed
                                </Badge>
                            )}

                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleReset}
                                disabled={isDisabled}
                                className="h-10 gap-2 border-primary/30 text-sidebar-accent hover:border-violet-400 hover:text-violet-700 dark:border-sidebar-accent dark:text-slate-200"
                            >
                                <RefreshCw className="h-4 w-4" />
                                {selectedId ? 'Cancel' : 'Reset'}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
            )}

            {/* Transactions Table */}
            <div className="space-y-4">
                <div style={{ display: 'none' }}>
                    {printData && <JournalPrint ref={printRef} data={printData} branch={printBranch} />}
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-lg font-semibold text-sidebar-accent dark:text-slate-200">
                            Recent Journal Vouchers
                            {displayTotalCount > 0 && (
                                <Badge variant="secondary" className="ml-2 text-xs">{displayTotalCount}</Badge>
                            )}
                        </h3>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                                <TabsList>
                                    <TabsTrigger value="all">All</TabsTrigger>
                                    <TabsTrigger value="pending">Yet To Approve</TabsTrigger>
                                    <TabsTrigger value="approved">Approved</TabsTrigger>
                                    <TabsTrigger value="rejected">Rejected</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <ExportDropdown onExportPDF={handleExportPDF} onExportExcel={handleExportExcel} className="h-10" />
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full">
                        <TransactionBranchFilter value={branchFilter} onChange={setBranchFilter} />
                        <DateInput
                            value={fromDate}
                            onChange={e => setFromDate(e.target.value)}
                            className="w-[150px]"
                        />
                        <DateInput
                            value={toDate}
                            onChange={e => setToDate(e.target.value)}
                            className="w-[150px]"
                        />
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                placeholder="Search voucher, account..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-green-950 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-green-50 dark:bg-brand-green-darker">
                                <TableRow>
                                    <TableHead className="w-36">Voucher No</TableHead>
                                    <TableHead className="w-32">Date</TableHead>
                                    <TableHead>Branch</TableHead>
                                    <TableHead>Debit Account</TableHead>
                                    <TableHead>Credit Account</TableHead>
                                    <TableHead className="text-right">Amount (₹)</TableHead>
                                    <TableHead>Narration</TableHead>
                                    <TableHead className="w-36">Created By</TableHead>
                                    <TableHead className="text-center">Print</TableHead>
                                    {isBM && <TableHead>Status</TableHead>}
                                    {(isAdmin || isAM || isSubAdmin) && <TableHead className="text-center">Checker</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {transactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={10} className="h-32 text-center text-slate-500">
                                            {displayTotalCount === 0
                                                ? 'No journal vouchers found.'
                                                : 'No results match your search.'}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    transactions.map(tx => (
                                        <TableRow
                                            key={tx.id}
                                            onClick={() => handleRowClick(tx)}
                                            className={cn(
                                                'cursor-pointer transition-colors hover:bg-violet-50/50 dark:hover:bg-violet-950/20',
                                                selectedId === tx.id && 'bg-violet-50 dark:bg-violet-950/30 ring-1 ring-inset ring-violet-300 dark:ring-violet-700'
                                            )}
                                        >
                                            <TableCell className="font-mono font-semibold text-violet-600 dark:text-violet-400">
                                                {tx.voucherNo}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5 text-sidebar-accent dark:text-slate-400 text-sm">
                                                    <Calendar className="h-3 w-3" />
                                                    {format(new Date(tx.transactionDate), 'dd/MM/yyyy')}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {tx.branch ? `${tx.branch.code} — ${tx.branch.name}` : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="rounded-full bg-violet-100 p-1 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
                                                        <BookMarked className="h-3 w-3" />
                                                    </div>
                                                    <span className="font-medium text-sm">{tx.ledger?.ledgerName ?? '—'}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-sm text-sidebar-accent dark:text-slate-300">
                                                    {tx.creditLedger?.ledgerName ?? '—'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white tabular-nums">
                                                {fmtAmount(tx.amount)}
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-500 max-w-xs truncate">
                                                {stripPostingMarker(tx.description) || '—'}
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-500">
                                                {tx.createdBy.firstName} {tx.createdBy.lastName}
                                            </TableCell>
                                            <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => triggerPrint(tx)}>
                                                    <Printer className="h-4 w-4 text-violet-600" />
                                                </Button>
                                            </TableCell>
                                            {isBM && (
                                                <TableCell>
                                                    <JournalApprovalBadge status={tx.approvalStatus} reason={tx.rejectionReason} />
                                                </TableCell>
                                            )}
                                            {(isAdmin || isAM || isSubAdmin) && (
                                                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                                    {tx.approvalStatus === 'PENDING_APPROVAL' && (tx.eodLocked || tx.canModify === false) && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] gap-1 bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap cursor-pointer"
                                                            onClick={() => openChecker(tx)}
                                                        >
                                                            <Lock className="h-3 w-3" /> EOD locked
                                                        </Badge>
                                                    )}
                                                    {tx.approvalStatus === 'PENDING_APPROVAL' && !(tx.eodLocked || tx.canModify === false) && (
                                                        <Button size="sm" className="h-7 px-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs" onClick={() => openChecker(tx)}>
                                                            Approve
                                                        </Button>
                                                    )}
                                                    {(tx.approvalStatus === 'APPROVED' || tx.approvalStatus === 'REVERTED') && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openChecker(tx)}>
                                                            <CheckCircle className="h-4 w-4 text-emerald-600" />
                                                        </Button>
                                                    )}
                                                    {tx.approvalStatus === 'REJECTED' && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-xs bg-red-100 text-red-700 border-red-200 cursor-pointer"
                                                            onClick={() => openChecker(tx)}
                                                        >
                                                            Rejected
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {displayTotalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-4 py-3">
                            <p className="text-sm text-slate-500">
                                Page {page} of {displayTotalPages} &nbsp;·&nbsp; {displayTotalCount} records
                            </p>
                            <div className="flex gap-1">
                                <Button variant="outline" size="icon" onClick={() => handlePageChange(1)} disabled={page === 1} className="h-8 w-8">
                                    <ChevronsLeft className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1} className="h-8 w-8">
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon" onClick={() => handlePageChange(Math.min(displayTotalPages, page + 1))} disabled={page === displayTotalPages} className="h-8 w-8">
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon" onClick={() => handlePageChange(displayTotalPages)} disabled={page === displayTotalPages} className="h-8 w-8">
                                    <ChevronsRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <TransactionApprovalModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                transaction={modalRow as unknown as TransactionModalRow}
                canAct={modalRow ? canActOnRow(modalRow) : false}
                canRevertRole={isAdmin || isSubAdmin}
                onActionComplete={refreshTransactions}
            />
        </div>
    );
}
