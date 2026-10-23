'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar, Pencil, Trash2, Save, X, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { TransactionBranchFilter } from '@/components/transactions/TransactionBranchFilter';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

// Types
type TransactionRow = {
    id: string;
    voucherNo: string;
    transactionDate: string;
    type: string;     // Internal type e.g., CASH_PAYMENT
    typeCode: string; // Display code e.g., CP
    amount: number;
    narration: string;
    debitAccountName: string;
    creditAccountName: string;
    debitAccountId: string;
    creditAccountId: string;
};

type AccountOption = {
    id: string;
    name: string;
};

export function VoucherModificationComponent() {
    const { toast } = useToast();
    const today = new Date().toISOString().split('T')[0];

    // State
    const [searchDate, setSearchDate] = useState<string>(today);
    const [branchFilter, setBranchFilter] = useState('all');
    const [transactions, setTransactions] = useState<TransactionRow[]>([]);
    const [loading, setLoading] = useState(false);

    // Resources
    const [ledgers, setLedgers] = useState<AccountOption[]>([]);
    const [selfAccounts, setSelfAccounts] = useState<AccountOption[]>([]);
    const [loadingResources, setLoadingResources] = useState(true);

    const [selectedTx, setSelectedTx] = useState<TransactionRow | null>(null);
    const [formData, setFormData] = useState({
        transactionDate: today,
        amount: '',
        debitAccountId: '',
        creditAccountId: '',
        narration: '',
    });
    const [saving, setSaving] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // 1. Fetch Resources
    useEffect(() => {
        const fetchResources = async () => {
            try {
                const [ledRes, selfRes] = await Promise.all([
                    fetch('/api/accounts/ledgers'),
                    fetch('/api/accounts/self')
                ]);

                if (ledRes.ok) {
                    const ledData = await ledRes.json();
                    setLedgers((ledData.data || []).map((l: any) => ({ id: l.id, name: l.ledgerName || l.name })));
                }
                if (selfRes.ok) {
                    const selfData = await selfRes.json();
                    setSelfAccounts(selfData.data || []);
                }
            } catch (err) {
                console.error("Resource fetch error:", err);
                toast({ title: "Error", description: "Failed to load account lists.", variant: "destructive" });
            } finally {
                setLoadingResources(false);
            }
        };
        fetchResources();
    }, [toast]);

    // 2. Fetch Transactions
    const fetchTransactions = useCallback(async () => {
        if (!searchDate) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({ date: searchDate });
            if (branchFilter && branchFilter !== 'all') params.set('branchId', branchFilter);
            const res = await fetch(`/api/transactions/by-date?${params.toString()}`);
            const json = await res.json();
            if (json.success) {
                setTransactions(json.data);
            } else {
                setTransactions([]);
                if (json.message !== "No transactions found") {
                    toast({ title: "Notice", description: json.message });
                }
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to fetch transactions.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [searchDate, branchFilter, toast]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    // 3. Handle Edit Click
    const handleSelectRow = (tx: TransactionRow) => {
        setSelectedTx(tx);
        setFormData({
            transactionDate: tx.transactionDate,
            amount: String(tx.amount),
            debitAccountId: tx.debitAccountId,
            creditAccountId: tx.creditAccountId,
            narration: tx.narration,
        });

        const formElement = document.getElementById('modification-form');
        if (formElement) {
            formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    const handleReset = () => {
        setSelectedTx(null);
        setFormData({
            transactionDate: searchDate,
            amount: '',
            debitAccountId: '',
            creditAccountId: '',
            narration: '',
        });
    };

    // 4. Save Changes
    const handleSave = async () => {
        if (!selectedTx) {
            toast({ title: "No Selection", description: "Please select a voucher from the table first.", variant: "destructive" });
            return;
        }

        const errors: string[] = [];
        if (!formData.transactionDate) errors.push("Date");
        if (!formData.amount || isNaN(parseFloat(formData.amount))) errors.push("Valid Amount");
        if (!formData.debitAccountId) errors.push("Debit Account");
        if (!formData.creditAccountId) errors.push("Credit Account");

        if (errors.length > 0) {
            toast({
                title: "Validation Error",
                description: `Please fill correct values: ${errors.join(', ')}`,
                variant: "destructive"
            });
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`/api/transactions/${selectedTx.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionDate: formData.transactionDate,
                    amount: formData.amount,
                    debitAccountId: formData.debitAccountId,
                    creditAccountId: formData.creditAccountId,
                    description: formData.narration,
                    originalType: selectedTx.type,
                }),
            });

            const json = await res.json();
            if (json.success) {
                toast({
                    title: "Success",
                    description: `Voucher #${selectedTx.voucherNo} updated successfully.`,
                    className: "bg-green-600 text-white"
                });
                handleReset();
                fetchTransactions();
            } else {
                toast({ title: "Error", description: json.message || "Update failed.", variant: "destructive" });
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to update transaction.", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    // 5. Delete Transaction
    const handleDelete = async () => {
        if (!selectedTx) return;
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = async () => {
        if (!selectedTx) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/transactions/${selectedTx.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                toast({
                    title: "Deleted",
                    description: `Voucher #${selectedTx.voucherNo} deleted successfully.`,
                    className: "bg-orange-600 text-white"
                });
                handleReset();
                fetchTransactions();
            } else {
                toast({ title: "Error", description: json.message || "Delete failed.", variant: "destructive" });
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to delete transaction.", variant: "destructive" });
        } finally {
            setSaving(false);
            setIsDeleteDialogOpen(false);
        }
    };

    // Helpers for Accounts
    const getDebitOptions = () => {
        if (!selectedTx) return [];
        switch (selectedTx.type) {
            case 'CASH_PAYMENT':
            case 'BANK_PAYMENT':
            case 'JOURNAL':
                return ledgers;
            case 'CASH_RECEIPT':
            case 'BANK_RECEIPT':
            case 'CONTRA':
                return selfAccounts;
            default:
                return [...ledgers, ...selfAccounts];
        }
    };

    const getCreditOptions = () => {
        if (!selectedTx) return [];
        switch (selectedTx.type) {
            case 'CASH_PAYMENT':
            case 'BANK_PAYMENT':
            case 'CONTRA':
                return selfAccounts;
            case 'CASH_RECEIPT':
            case 'BANK_RECEIPT':
            case 'JOURNAL':
                return ledgers;
            default:
                return [...ledgers, ...selfAccounts];
        }
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(transactions);

    if (loadingResources) {
        return <PageLoader label="Loading Financial Modules..." fullScreen={false} />;
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Filter Section */}
            <Card className="border-none shadow-md bg-white/60 backdrop-blur-md dark:bg-green-950/60 border border-primary/20/50 dark:border-sidebar-accent/50">
                <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-50 dark:bg-brand-green-darker/20 rounded-lg">
                                <Calendar className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Voucher Selection</h3>
                                <p className="text-xs text-slate-500">Pick a date to view and modify transactions</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                            <TransactionBranchFilter value={branchFilter} onChange={setBranchFilter} />
                            <DateInput
                                value={searchDate}
                                onChange={(e) => setSearchDate(e.target.value)}
                                className="h-10 bg-white/80 dark:bg-brand-green-darker/80 border-primary/20 w-full md:w-48 transition-all focus:ring-2 focus:ring-primary/20"
                            />
                            <Button
                                onClick={fetchTransactions}
                                disabled={loading}
                                className="h-10 px-6 font-bold bg-primary hover:bg-primary text-white shadow-lg shadow-primary/20 active:scale-95 transition-all"
                            >
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                Search
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card
                id="modification-form"
                className={cn(
                    "border-none shadow-xl transition-all duration-500 overflow-hidden",
                    selectedTx
                        ? "ring-2 ring-primary/30 bg-white dark:bg-brand-green-darker"
                        : "opacity-60 bg-green-50/50 dark:bg-brand-green-darker/50 grayscale-[0.5]"
                )}
            >
                <div className={cn(
                    "px-6 py-4 border-b flex items-center justify-between",
                    selectedTx
                        ? "bg-gradient-to-r from-green-50 to-green-50 dark:from-brand-green-darker/30 dark:to-brand-green-darker/30 border-primary/20 dark:border-brand-green-darker/30"
                        : "bg-green-50 dark:bg-green-950/30 border-slate-100 dark:border-sidebar-accent"
                )}>
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center transition-all",
                            selectedTx ? "bg-primary text-white shadow-lg shadow-primary/30" : "bg-brand-green-tint dark:bg-sidebar-accent text-slate-400"
                        )}>
                            <Pencil className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-bold text-sidebar-accent dark:text-white">
                                {selectedTx ? `Modifying Voucher: ${selectedTx.typeCode}-${selectedTx.voucherNo}` : 'Modification Form'}
                            </CardTitle>
                            <CardDescription className="text-xs">
                                {selectedTx ? 'Enter new details and save changes' : 'Select a transaction from the table below to edit'}
                            </CardDescription>
                        </div>
                    </div>
                    {selectedTx && (
                        <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-400 hover:text-rose-500">
                            <X className="h-4 w-4 mr-1" /> Cancel
                        </Button>
                    )}
                </div>

                <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Date</Label>
                            <DateInput
                                disabled={!selectedTx}
                                value={formData.transactionDate}
                                onChange={(e) => setFormData({ ...formData, transactionDate: e.target.value })}
                                className="h-11 bg-white dark:bg-green-950 border-primary/20 focus:border-primary transition-colors"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Amount (₹)</Label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                disabled={!selectedTx}
                                value={formData.amount}
                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                className="h-11 bg-white dark:bg-green-950 border-primary/20 font-bold text-primary text-lg"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Debit Account</Label>
                            <Select
                                disabled={!selectedTx}
                                value={formData.debitAccountId}
                                onValueChange={(val) => setFormData({ ...formData, debitAccountId: val })}
                            >
                                <SelectTrigger className="h-11 bg-white dark:bg-green-950 border-primary/20">
                                    <SelectValue placeholder="Select Account" />
                                </SelectTrigger>
                                <SelectContent>
                                    {getDebitOptions().map((acc) => (
                                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Credit Account</Label>
                            <Select
                                disabled={!selectedTx}
                                value={formData.creditAccountId}
                                onValueChange={(val) => setFormData({ ...formData, creditAccountId: val })}
                            >
                                <SelectTrigger className="h-11 bg-white dark:bg-green-950 border-primary/20">
                                    <SelectValue placeholder="Select Account" />
                                </SelectTrigger>
                                <SelectContent>
                                    {getCreditOptions().map((acc) => (
                                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="md:col-span-4 space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Narration / Description</Label>
                            <Textarea
                                disabled={!selectedTx}
                                value={formData.narration}
                                onChange={(e) => setFormData({ ...formData, narration: e.target.value })}
                                className="min-h-[60px] bg-white dark:bg-green-950 border-primary/20 resize-none py-3"
                                placeholder="Enter transaction explanation..."
                            />
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 dark:border-sidebar-accent flex flex-wrap items-center gap-4">
                        <Button
                            onClick={handleSave}
                            disabled={saving || !selectedTx}
                            className="bg-primary hover:bg-primary text-white px-8 h-11 font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
                        >
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Update Voucher
                        </Button>

                        <Button
                            onClick={handleDelete}
                            disabled={saving || !selectedTx}
                            variant="destructive"
                            className="px-8 h-11 font-bold shadow-lg shadow-rose-500/10 active:scale-95 transition-all"
                        >
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            Delete
                        </Button>

                        <Button
                            onClick={handleReset}
                            disabled={saving || !selectedTx}
                            variant="outline"
                            className="h-11 px-6 font-bold border-primary/20 hover:bg-green-50 ml-auto"
                        >
                            Clear Selection
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-none shadow-2xl overflow-hidden bg-white dark:bg-brand-green-darker border border-primary/20/50 dark:border-sidebar-accent/50">
                <CardHeader className="bg-brand-green-darker dark:bg-black text-white px-6 py-4 flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-sm font-bold tracking-tight">Voucher History</CardTitle>
                        <CardDescription className="text-[10px] text-slate-400 mt-1 uppercase">Records for selected date</CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search vouchers..."
                        />
                        <span className="text-[10px] font-bold bg-primary px-2 py-0.5 rounded">Total: {searchedRows.length}</span>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="max-h-[500px] overflow-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-sidebar-accent">
                        <Table>
                            <TableHeader className="bg-brand-green-tint dark:bg-sidebar-accent sticky top-0 z-10 shadow-sm">
                                <TableRow className="border-none hover:bg-transparent">
                                    <TableHead className="font-black text-sidebar-accent dark:text-slate-200 h-11 text-[11px] uppercase tracking-tighter">Type</TableHead>
                                    <TableHead className="font-black text-sidebar-accent dark:text-slate-200 h-11 text-[11px] uppercase tracking-tighter">Voucher</TableHead>
                                    <TableHead className="font-black text-sidebar-accent dark:text-slate-200 h-11 text-[11px] uppercase tracking-tighter">Debit Account</TableHead>
                                    <TableHead className="font-black text-sidebar-accent dark:text-slate-200 h-11 text-[11px] uppercase tracking-tighter">Credit Account</TableHead>
                                    <TableHead className="font-black text-sidebar-accent dark:text-slate-200 h-11 text-[11px] uppercase tracking-tighter text-right">Amount (₹)</TableHead>
                                    <TableHead className="font-black text-sidebar-accent dark:text-slate-200 h-11 text-[11px] uppercase tracking-tighter">Narration</TableHead>
                                    <TableHead className="h-11 w-20"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-48 text-center italic text-slate-400">
                                            {loading ? 'Fetching...' : 'No transaction records found.'}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    searchedRows.map((tx) => (
                                        <TableRow
                                            key={tx.id}
                                            className={cn(
                                                "group transition-all duration-300 border-b border-slate-50 dark:border-sidebar-accent/50",
                                                selectedTx?.id === tx.id
                                                    ? "bg-green-50/70 dark:bg-brand-green-darker/10"
                                                    : "hover:bg-green-50/80 dark:hover:bg-sidebar-accent/30"
                                            )}
                                        >
                                            <TableCell>
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded-full text-[10px] font-black",
                                                    tx.typeCode === 'CV' ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                                                        tx.typeCode === 'CP' ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" :
                                                            tx.typeCode === 'CR' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                                                                "bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/30 dark:text-primary"
                                                )}>
                                                    {tx.typeCode}
                                                </span>
                                            </TableCell>
                                            <TableCell className="font-bold text-sidebar-accent dark:text-slate-300">{tx.voucherNo}</TableCell>
                                            <TableCell className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">{tx.debitAccountName}</TableCell>
                                            <TableCell className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">{tx.creditAccountName}</TableCell>
                                            <TableCell className="text-right font-black text-foreground dark:text-white tabular-nums">
                                                {new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(tx.amount)}
                                            </TableCell>
                                            <TableCell className="text-[10px] text-slate-400 max-w-[200px] truncate italic" title={tx.narration}>
                                                {tx.narration || '-'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant={selectedTx?.id === tx.id ? "default" : "secondary"}
                                                    onClick={() => handleSelectRow(tx)}
                                                    className={cn(
                                                        "h-8 w-8 p-0 rounded-full transition-all group-hover:scale-110",
                                                        selectedTx?.id === tx.id ? "bg-primary scale-110 shadow-lg shadow-primary/20" : "bg-brand-green-tint dark:bg-sidebar-accent hover:bg-primary hover:text-white"
                                                    )}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <ConfirmationDialog
                open={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                onConfirm={confirmDelete}
                title="Delete Voucher"
                description={`Are you sure you want to PERMANENTLY delete Voucher #${selectedTx?.voucherNo}? This action cannot be undone.`}
                confirmText="Delete Voucher"
                isLoading={saving}
                type="delete"
            />
        </div>
    );
}
