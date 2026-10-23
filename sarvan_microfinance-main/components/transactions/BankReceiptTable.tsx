'use client';

import { useState, useEffect, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Search,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Calendar,
    ArrowUpRight,
    ArrowDownLeft,
    Printer,
    CheckCircle,
    XCircle,
    Pencil,
    Trash2,
    Loader2,
    Lock,
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { TransactionApprovalModal, TransactionModalRow } from './TransactionApprovalModal';
import { TransactionBranchFilter } from './TransactionBranchFilter';
import { BankReceiptPrint, BankReceiptPrintData } from './BankReceiptPrint';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { DateInput } from '@/components/ui/date-input';

export interface BankReceiptRow {
    id: string;
    voucherNo: string;
    transactionDate: string; // ISO string
    selfAccount: { id: string; name: string };
    ledger: { id: string; name: string; ledgerName: string }; // Handle potential naming diff
    amount: number;
    description?: string;
    instrumentNo?: string;
    bankName?: string;
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

function StatusBadge({ status, reason }: { status?: string; reason?: string }) {
    const config: Record<string, { label: string; className: string }> = {
        PENDING_APPROVAL: { label: 'Pending', className: 'bg-amber-100 text-amber-700 border-amber-200' },
        APPROVED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-700 border-red-200' },
        REVERTED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    };
    const c = config[status ?? ''] ?? { label: status ?? '—', className: 'bg-gray-100 text-gray-600' };
    return (
        <Badge
            variant="outline"
            className={`text-xs ${c.className}`}
            title={status === 'REJECTED' && reason ? `Reason: ${reason}` : undefined}
        >
            {c.label}
        </Badge>
    );
}

interface BankReceiptTableProps {
    rows: BankReceiptRow[];
    onRefresh: () => void;
    branchFilter?: string;
    onBranchFilterChange?: (branchId: string) => void;
    onEditRequest: (row: BankReceiptRow) => void;
    activeTab: 'all' | 'pending' | 'approved' | 'rejected';
    onActiveTabChange: (tab: 'all' | 'pending' | 'approved' | 'rejected') => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    fromDate: string;
    onFromDateChange: (d: string) => void;
    toDate: string;
    onToDateChange: (d: string) => void;
    page: number;
    totalPages: number;
    totalCount: number;
    onPageChange: (page: number) => void;
    onExportPDF?: () => void | Promise<void>;
    onExportExcel?: () => void | Promise<void>;
}

export function BankReceiptTable({
    rows, onRefresh, branchFilter, onBranchFilterChange, onEditRequest,
    activeTab, onActiveTabChange, searchQuery, onSearchChange,
    fromDate, onFromDateChange, toDate, onToDateChange,
    onExportPDF, onExportExcel,
    page, totalPages, totalCount, onPageChange,
}: BankReceiptTableProps) {
    const { toast } = useToast();

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

    const [modalRow, setModalRow] = useState<BankReceiptRow | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    // Remove confirm
    const [removeRow, setRemoveRow] = useState<BankReceiptRow | null>(null);
    const [isRemoving, setIsRemoving] = useState(false);

    const printRef = useRef<HTMLDivElement>(null);
    const [printData, setPrintData] = useState<BankReceiptPrintData | null>(null);
    const [printBranch, setPrintBranch] = useState<{ code: string; name: string } | null>(null);
    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Bank_Receipt_${printData?.voucherNo || 'System'}`,
    });

    const canActOnRow = (row: BankReceiptRow) => {
        if (isAdmin || isSubAdmin) return true;
        if (isAM) return !row.branch?.id || assignedBranchIds.includes(row.branch.id);
        return false;
    };

    const handleRemove = async () => {
        if (!removeRow) return;
        setIsRemoving(true);
        try {
            const res = await fetch(`/api/transactions/${removeRow.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message || 'Failed to remove transaction');
            toast({ title: 'Removed', description: 'Bank receipt removed successfully.' });
            setRemoveRow(null);
            onRefresh();
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        } finally {
            setIsRemoving(false);
        }
    };

    const openChecker = (row: BankReceiptRow) => {
        setModalRow(row);
        setModalOpen(true);
    };

    const triggerPrint = (row: BankReceiptRow) => {
        setPrintData({
            voucherNo: row.voucherNo,
            transactionDate: row.transactionDate,
            accountName: row.ledger?.ledgerName || '—',
            throughAccount: row.selfAccount?.name || '—',
            narration: row.description,
            amount: Number(row.amount),
        });
        setPrintBranch(row.branch ? { code: row.branch.code, name: row.branch.name } : null);
        setTimeout(() => handlePrint(), 100);
    };

    return (
        <div className="space-y-4">
            <div style={{ display: 'none' }}>
                {printData && <BankReceiptPrint ref={printRef} data={printData} branch={printBranch} />}
            </div>

            {/* Header & Search */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-semibold text-sidebar-accent dark:text-slate-200">
                        Recent Transactions
                    </h3>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Tabs value={activeTab} onValueChange={(v) => onActiveTabChange(v as any)}>
                            <TabsList>
                                <TabsTrigger value="all">All</TabsTrigger>
                                <TabsTrigger value="pending">Yet To Approve</TabsTrigger>
                                <TabsTrigger value="approved">Approved</TabsTrigger>
                                <TabsTrigger value="rejected">Rejected</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {(onExportPDF || onExportExcel) && (
                            <ExportDropdown onExportPDF={onExportPDF} onExportExcel={onExportExcel} className="h-10" />
                        )}
                    </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full">
                    {onBranchFilterChange && (
                        <TransactionBranchFilter value={branchFilter ?? 'all'} onChange={onBranchFilterChange} />
                    )}
                    <DateInput
                        value={fromDate}
                        onChange={(e) => onFromDateChange(e.target.value)}
                        className="w-[150px]"
                    />
                    <DateInput
                        value={toDate}
                        onChange={(e) => onToDateChange(e.target.value)}
                        className="w-[150px]"
                    />
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            placeholder="Search voucher, account..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-green-950 overflow-hidden">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-green-50 dark:bg-brand-green-darker">
                            <TableRow>
                                <TableHead className="w-[120px]">Voucher No</TableHead>
                                <TableHead className="w-[120px]">Date</TableHead>
                                <TableHead>Branch</TableHead>
                                <TableHead>Debit (Bank)</TableHead>
                                <TableHead>Credit (Ledger)</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead className="w-[150px]">Created By</TableHead>
                                {(isAdmin || isSubAdmin) && <TableHead className="text-center">Edit</TableHead>}
                                <TableHead className="text-center">Print</TableHead>
                                {(isAdmin || isSubAdmin) && <TableHead className="text-center">Remove</TableHead>}
                                {isBM && <TableHead>Status</TableHead>}
                                {(isAdmin || isAM || isSubAdmin) && <TableHead className="text-center">Checker</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={12} className="h-32 text-center text-slate-500">
                                        No transactions found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((row) => {
                                    const isEodBlocked = row.canModify === false;
                                    const isApprovalBlocked = row.approvalStatus === 'APPROVED';
                                    const canModify = (isAdmin || isSubAdmin) && !isEodBlocked && !isApprovalBlocked;
                                    // Delete is intentionally NOT gated by approval status — matches Cash Payment's rule.
                                    const canRemove = (isAdmin || isSubAdmin) && !isEodBlocked;
                                    return (
                                    <TableRow key={row.id} className="hover:bg-green-50/50 dark:hover:bg-brand-green-darker/50">
                                        <TableCell className="font-medium text-primary dark:text-primary">
                                            {row.voucherNo}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2 text-sidebar-accent dark:text-slate-400">
                                                <Calendar className="h-3 w-3" />
                                                {format(new Date(row.transactionDate), 'dd/MM/yyyy')}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {row.branch ? `${row.branch.code} — ${row.branch.name}` : '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="rounded-full bg-emerald-100 p-1 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                                                    <ArrowDownLeft className="h-3 w-3" />
                                                </div>
                                                <span className="font-medium">{row.selfAccount?.name || 'Unknown'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="rounded-full bg-amber-100 p-1 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                                                    <ArrowUpRight className="h-3 w-3" />
                                                </div>
                                                <span className="text-sidebar-accent dark:text-slate-300">{row.ledger?.ledgerName || 'Unknown'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-foreground dark:text-white">
                                            ₹{typeof row.amount === 'number' ? row.amount.toFixed(2) : parseFloat(row.amount).toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-sm text-slate-500">
                                            {row.createdBy?.firstName} {row.createdBy?.lastName}
                                        </TableCell>
                                        {(isAdmin || isSubAdmin) && (
                                            <TableCell className="text-center">
                                                {canModify ? (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditRequest(row)}>
                                                        <Pencil className="h-4 w-4 text-primary" />
                                                    </Button>
                                                ) : isApprovalBlocked ? (
                                                    <Badge variant="outline" className="text-[10px] gap-1 bg-slate-100 text-slate-600 border-slate-200 whitespace-nowrap" title="Revert the transaction to enable editing">
                                                        <Lock className="h-3 w-3" /> Approved — revert to edit
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[10px] gap-1 bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap">
                                                        <Lock className="h-3 w-3" /> EOD completed
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        )}
                                        <TableCell className="text-center">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => triggerPrint(row)}>
                                                <Printer className="h-4 w-4 text-primary" />
                                            </Button>
                                        </TableCell>
                                        {(isAdmin || isSubAdmin) && (
                                            <TableCell className="text-center">
                                                {canRemove ? (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRemoveRow(row)}>
                                                        <Trash2 className="h-4 w-4 text-red-600" />
                                                    </Button>
                                                ) : (
                                                    <Badge variant="outline" className="text-[10px] gap-1 bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap">
                                                        <Lock className="h-3 w-3" /> EOD completed
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        )}
                                        {isBM && (
                                            <TableCell>
                                                <StatusBadge status={row.approvalStatus} reason={row.rejectionReason} />
                                            </TableCell>
                                        )}
                                        {(isAdmin || isAM || isSubAdmin) && (
                                            <TableCell className="text-center">
                                                {row.approvalStatus === 'PENDING_APPROVAL' && (row.eodLocked || row.canModify === false) && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] gap-1 bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap cursor-pointer"
                                                        onClick={() => openChecker(row)}
                                                    >
                                                        <Lock className="h-3 w-3" /> EOD locked
                                                    </Badge>
                                                )}
                                                {row.approvalStatus === 'PENDING_APPROVAL' && !(row.eodLocked || row.canModify === false) && (
                                                    <Button size="sm" className="h-7 px-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs" onClick={() => openChecker(row)}>
                                                        Approve
                                                    </Button>
                                                )}
                                                {(row.approvalStatus === 'APPROVED' || row.approvalStatus === 'REVERTED') && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openChecker(row)}>
                                                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                                                    </Button>
                                                )}
                                                {row.approvalStatus === 'REJECTED' && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-xs bg-red-100 text-red-700 border-red-200 cursor-pointer"
                                                        onClick={() => openChecker(row)}
                                                    >
                                                        Rejected
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        )}
                                    </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-primary/20 px-4 py-4 dark:border-sidebar-accent">
                        <div className="text-sm text-slate-500">
                            Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                        </div>
                        <div className="flex gap-1">
                            <Button variant="outline" size="icon" onClick={() => onPageChange(1)} disabled={page === 1} className="h-8 w-8">
                                <ChevronsLeft className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="h-8 w-8">
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="h-8 w-8">
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => onPageChange(totalPages)} disabled={page === totalPages} className="h-8 w-8">
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <TransactionApprovalModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                transaction={modalRow as unknown as TransactionModalRow}
                canAct={modalRow ? canActOnRow(modalRow) : false}
                canRevertRole={isAdmin || isSubAdmin}
                onActionComplete={onRefresh}
            />

            {/* Remove Confirm Dialog */}
            <Dialog open={!!removeRow} onOpenChange={(open) => !open && setRemoveRow(null)}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-700">
                            <XCircle className="h-5 w-5" />
                            Remove Voucher
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Are you sure you want to remove voucher <strong className="font-mono">{removeRow?.voucherNo}</strong>? This cannot be undone.
                    </p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRemoveRow(null)} disabled={isRemoving}>Cancel</Button>
                        <Button variant="destructive" onClick={handleRemove} disabled={isRemoving}>
                            {isRemoving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
