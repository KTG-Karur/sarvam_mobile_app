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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, ArrowUpCircle, Pencil, Trash2, Printer, CheckCircle, XCircle, ChevronLeft, ChevronRight, Lock, Search } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { TransactionApprovalModal, TransactionModalRow } from './TransactionApprovalModal';
import { TransactionBranchFilter } from './TransactionBranchFilter';
import { CashReceiptPrint, CashReceiptPrintData } from './CashReceiptPrint';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

export interface CashReceiptRow {
    id: string;
    transactionDate: string;
    voucherNo: string;
    type: string;
    selfAccount: { id: string; name: string };
    ledger: { id: string; ledgerName: string };
    amount: number;
    description?: string;
    createdBy?: { firstName: string; lastName: string };
    approvalStatus?: string;
    rejectionReason?: string;
    rejectedBy?: { firstName: string; lastName: string };
    rejectedAt?: string;
    revertReason?: string;
    revertedBy?: { firstName: string; lastName: string };
    revertedAt?: string;
    instrumentNo?: string;
    bankName?: string;
    branch?: { id: string; code: string; name: string } | null;
    canModify?: boolean;
    modifyBlockedReason?: string;
    eodLocked?: boolean;
    /** Set on system-posted vouchers (e.g. EOD collection postings). Non-null =>
     *  owned by another workflow; must not be edited/deleted/reverted from this
     *  screen — use that workflow's own revert flow instead. */
    postingMarker?: string | null;
}

interface CashReceiptTableProps {
    rows: CashReceiptRow[];
    isLoading?: boolean;
    onRefresh: () => void;
    branchFilter?: string;
    onBranchFilterChange?: (branchId: string) => void;
    onEditRequest: (row: CashReceiptRow) => void;
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

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);
};

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

export function CashReceiptTable({
    rows, isLoading, onRefresh, branchFilter, onBranchFilterChange, onEditRequest,
    activeTab, onActiveTabChange, searchQuery, onSearchChange,
    fromDate, onFromDateChange, toDate, onToDateChange,
    page, totalPages, totalCount, onPageChange,
    onExportPDF, onExportExcel,
}: CashReceiptTableProps) {
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

    // Approval modal
    const [modalRow, setModalRow] = useState<CashReceiptRow | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    // Remove confirm
    const [removeRow, setRemoveRow] = useState<CashReceiptRow | null>(null);
    const [isRemoving, setIsRemoving] = useState(false);

    // Print
    const printRef = useRef<HTMLDivElement>(null);
    const [printData, setPrintData] = useState<CashReceiptPrintData | null>(null);
    const [printBranch, setPrintBranch] = useState<{ code: string; name: string } | null>(null);
    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Cash_Receipt_${printData?.voucherNo || 'System'}`,
    });

    const openChecker = (row: CashReceiptRow) => {
        setModalRow(row);
        setModalOpen(true);
    };

    const canActOnRow = (row: CashReceiptRow) => {
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
            toast({ title: 'Removed', description: 'Cash receipt removed successfully.' });
            setRemoveRow(null);
            onRefresh();
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        } finally {
            setIsRemoving(false);
        }
    };

    const triggerPrint = (row: CashReceiptRow) => {
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

    if (isLoading) {
        return <PageLoader fullScreen={false} />;
    }

    return (
        <Card className="border-2 border-emerald-100 dark:border-emerald-900 shadow-sm mt-8">
            <div style={{ display: 'none' }}>
                {printData && <CashReceiptPrint ref={printRef} data={printData} branch={printBranch} />}
            </div>

            <CardHeader className="bg-emerald-50/50 dark:bg-emerald-950/20 pb-4">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-2">
                                <ArrowUpCircle className="h-5 w-5" />
                                Recent Transactions
                            </CardTitle>
                            <CardDescription>List of recent cash receipts.</CardDescription>
                        </div>
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
                                <ExportDropdown
                                    onExportPDF={onExportPDF}
                                    onExportExcel={onExportExcel}
                                    className="h-10 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                                />
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
                            className="h-10 w-[150px] rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-green-950 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        />
                        <DateInput
                            value={toDate}
                            onChange={(e) => onToDateChange(e.target.value)}
                            className="h-10 w-[150px] rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-green-950 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        />
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                placeholder="Search voucher, account..."
                                value={searchQuery}
                                onChange={(e) => onSearchChange(e.target.value)}
                                className="w-full h-10 pl-9 pr-4 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-green-950 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                            />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-emerald-100/40 dark:bg-emerald-900/40 hover:bg-emerald-100/50">
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">Voucher Date</TableHead>
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">Branch</TableHead>
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">Voucher No</TableHead>
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">Type</TableHead>
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">From Account</TableHead>
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">To Account</TableHead>
                                <TableHead className="text-right font-bold text-emerald-900 dark:text-emerald-100">Amount (₹)</TableHead>
                                <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">Created By</TableHead>
                                {(isAdmin || isSubAdmin) && <TableHead className="text-center font-bold text-emerald-900 dark:text-emerald-100">Edit</TableHead>}
                                <TableHead className="text-center font-bold text-emerald-900 dark:text-emerald-100">Print</TableHead>
                                {(isAdmin || isSubAdmin) && <TableHead className="text-center font-bold text-emerald-900 dark:text-emerald-100">Remove</TableHead>}
                                {isBM && <TableHead className="font-bold text-emerald-900 dark:text-emerald-100">Status</TableHead>}
                                {(isAdmin || isAM || isSubAdmin) && <TableHead className="text-center font-bold text-emerald-900 dark:text-emerald-100">Checker</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">
                                        No transactions found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((row) => {
                                    const isEodBlocked = row.canModify === false;
                                    const isApprovalBlocked = row.approvalStatus === 'APPROVED';
                                    // System-posted vouchers (e.g. EOD collection postings) are owned by
                                    // another workflow — edit/delete/reject here would desync the source
                                    // record. They can only be undone from that workflow's revert screen.
                                    const isSystemGenerated = !!row.postingMarker;
                                    const canModify = (isAdmin || isSubAdmin) && !isEodBlocked && !isApprovalBlocked && !isSystemGenerated;
                                    // Delete is intentionally NOT gated by approval status — out of scope,
                                    // leave its existing EOD-only behavior unchanged.
                                    const canRemove = (isAdmin || isSubAdmin) && !isEodBlocked && !isSystemGenerated;
                                    return (
                                        <TableRow key={row.id} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10">
                                            <TableCell className="font-medium">
                                                {format(new Date(row.transactionDate), 'dd/MM/yyyy')}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {row.branch ? `${row.branch.code} — ${row.branch.name}` : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="font-mono bg-white dark:bg-green-950">
                                                    {row.voucherNo}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs">Cash Receipt</TableCell>
                                            <TableCell>{row.ledger?.ledgerName || '-'}</TableCell>
                                            <TableCell>{row.selfAccount?.name || '-'}</TableCell>
                                            <TableCell className="text-right font-bold text-emerald-700 dark:text-emerald-400">
                                                {formatCurrency(Number(row.amount))}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : '—'}
                                            </TableCell>
                                            {(isAdmin || isSubAdmin) && (
                                                <TableCell className="text-center">
                                                    {canModify ? (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditRequest(row)}>
                                                            <Pencil className="h-4 w-4 text-emerald-600" />
                                                        </Button>
                                                    ) : isSystemGenerated ? (
                                                        <Badge variant="outline" className="text-[10px] gap-1 bg-slate-100 text-slate-600 border-slate-200 whitespace-nowrap" title="Auto-posted by another workflow (e.g. EOD collections) — undo it from that screen">
                                                            <Lock className="h-3 w-3" /> Auto-posted
                                                        </Badge>
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
                                                    <Printer className="h-4 w-4 text-emerald-600" />
                                                </Button>
                                            </TableCell>
                                            {(isAdmin || isSubAdmin) && (
                                                <TableCell className="text-center">
                                                    {canRemove ? (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRemoveRow(row)}>
                                                            <Trash2 className="h-4 w-4 text-red-600" />
                                                        </Button>
                                                    ) : isSystemGenerated ? (
                                                        <Badge variant="outline" className="text-[10px] gap-1 bg-slate-100 text-slate-600 border-slate-200 whitespace-nowrap" title="Auto-posted by another workflow (e.g. EOD collections) — undo it from that screen">
                                                            <Lock className="h-3 w-3" /> Auto-posted
                                                        </Badge>
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
                                                    {isSystemGenerated && (
                                                        <Badge variant="outline" className="text-[10px] gap-1 bg-slate-100 text-slate-600 border-slate-200 whitespace-nowrap" title="Auto-posted by another workflow (e.g. EOD collections) — undo it from that screen">
                                                            <Lock className="h-3 w-3" /> Auto-posted
                                                        </Badge>
                                                    )}
                                                    {!isSystemGenerated && row.approvalStatus === 'PENDING_APPROVAL' && (row.eodLocked || row.canModify === false) && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] gap-1 bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap cursor-pointer"
                                                            onClick={() => openChecker(row)}
                                                        >
                                                            <Lock className="h-3 w-3" /> EOD locked
                                                        </Badge>
                                                    )}
                                                    {!isSystemGenerated && row.approvalStatus === 'PENDING_APPROVAL' && !(row.eodLocked || row.canModify === false) && (
                                                        <Button size="sm" className="h-7 px-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs" onClick={() => openChecker(row)}>
                                                            Approve
                                                        </Button>
                                                    )}
                                                    {!isSystemGenerated && (row.approvalStatus === 'APPROVED' || row.approvalStatus === 'REVERTED') && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openChecker(row)}>
                                                            <CheckCircle className="h-4 w-4 text-emerald-600" />
                                                        </Button>
                                                    )}
                                                    {!isSystemGenerated && row.approvalStatus === 'REJECTED' && (
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

                {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                            Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                        </p>
                        <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="h-8 w-8">
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="h-8 w-8">
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>

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
        </Card>
    );
}
