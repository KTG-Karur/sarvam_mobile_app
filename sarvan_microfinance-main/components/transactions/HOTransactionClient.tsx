'use client';

import { useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { format } from 'date-fns';
import {
    ArrowDownToLine,
    ArrowUpFromLine,
    Building2,
    Calendar,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    IndianRupee,
    Info,
    Loader2,
    RefreshCw,
    ReceiptText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { HOTransactionType } from '@/app/api/transactions/ho-transaction/route';
import { DateInput } from '@/components/ui/date-input';

// ─── Types ────────────────────────────────────────────────────────────────────

type StoredUser = {
    role: string;
    branchId?: string | null;
    firstName?: string;
    lastName?: string;
};

type BranchOption = {
    id: string;
    name: string;
    code: string;
};

type HOTxRow = {
    id: string;
    voucherNo: string;
    transactionDate: string;
    transactionType: HOTransactionType;
    amount: number;
    description: string;
    ledgerName: string;
    branchCode: string;
    branchName: string;
    createdBy: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formSchema = z.object({
    transactionType: z.enum(['HO_BORROW', 'HO_REMITTANCE']),
    amount: z
        .string()
        .min(1, 'Amount is required')
        .refine((v) => !isNaN(Number(v)) && Number(v) > 0, { message: 'Amount must be a positive number' }),
    transactionDate: z.string().min(1, 'Transaction date is required'),
    branchId: z.string().min(1, 'Branch is required'),
    description: z.string().max(500).optional(),
});

type FormErrors = Partial<Record<keyof z.infer<typeof formSchema>, string>>;

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);

const todayISO = () => new Date().toISOString().split('T')[0];

// ─── Component ────────────────────────────────────────────────────────────────

export function HOTransactionClient() {
    const { toast } = useToast();

    // ── Auth context ──
    const [user, setUser] = useState<StoredUser | null>(null);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [isBranchesLoading, setIsBranchesLoading] = useState(false);

    // ── Form state ──
    const [transactionType, setTransactionType] = useState<HOTransactionType>('HO_BORROW');
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [transactionDate, setTransactionDate] = useState(todayISO());
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ── Transaction list state ──
    const [transactions, setTransactions] = useState<HOTxRow[]>([]);
    const [isListLoading, setIsListLoading] = useState(false);
    const [listDate, setListDate] = useState(todayISO());
    const [listPage, setListPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    const isAdmin = user?.role === 'ADMIN';
    const isDateEditable = isAdmin;

    // ── Load user from localStorage ──
    useEffect(() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw) setUser(JSON.parse(raw) as StoredUser);
        } catch {
            // ignore parse errors
        }
    }, []);

    // ── Load branches (Admin only) ──
    useEffect(() => {
        if (!user) return;
        if (!isAdmin) {
            if (user.branchId) setSelectedBranchId(user.branchId);
            return;
        }
        setIsBranchesLoading(true);
        fetch('/api/branches')
            .then((r) => r.json())
            .then((data) => {
                const list: BranchOption[] = (data.data ?? data ?? []).map((b: BranchOption) => ({
                    id: b.id,
                    name: b.name,
                    code: b.code,
                }));
                setBranches(list);
                // Auto-select the first branch (usually HO) or the active branch from cookie
                if (list.length > 0 && !selectedBranchId) {
                    const activeBranchId = user.branchId ?? list[0].id;
                    setSelectedBranchId(activeBranchId);
                }
            })
            .catch(() => {
                toast({ title: 'Failed to load branches', variant: 'destructive' });
            })
            .finally(() => setIsBranchesLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, isAdmin]);

    // ── Fetch transaction list ──
    const fetchTransactions = useCallback(
        async (page: number = 1) => {
            if (!selectedBranchId) return;
            setIsListLoading(true);
            try {
                const params = new URLSearchParams({
                    branchId: selectedBranchId,
                    date: listDate,
                    page: String(page),
                    pageSize: '10',
                });
                const res = await fetch(`/api/transactions/ho-transaction?${params}`);
                const data = await res.json();
                if (res.ok && data.success) {
                    setTransactions(data.data.transactions ?? []);
                    setTotalPages(data.data.totalPages ?? 1);
                    setTotalCount(data.data.totalCount ?? 0);
                    setListPage(page);
                }
            } catch {
                // silently handle network errors; user can retry
            } finally {
                setIsListLoading(false);
            }
        },
        [selectedBranchId, listDate],
    );

    // Reload list whenever branch or list date changes
    useEffect(() => {
        if (selectedBranchId) fetchTransactions(1);
    }, [selectedBranchId, listDate, fetchTransactions]);

    // ── Form validation ──
    const validate = (): boolean => {
        const result = formSchema.safeParse({
            transactionType,
            amount,
            transactionDate,
            branchId: selectedBranchId,
        });
        if (!result.success) {
            const fieldErrors: FormErrors = {};
            for (const err of result.error.errors) {
                const key = err.path[0] as keyof FormErrors;
                if (!fieldErrors[key]) fieldErrors[key] = err.message;
            }
            setErrors(fieldErrors);
            return false;
        }
        setErrors({});
        return true;
    };

    // ── Submit ──
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/transactions/ho-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionType,
                    amount: Number(amount),
                    transactionDate,
                    branchId: selectedBranchId,
                    description: description.trim() || undefined,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error ?? data.message ?? 'Transaction failed');
            }

            toast({
                title: 'Transaction posted',
                description: data.message,
                className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
            });

            // Reset form (keep branch + date for quick multi-entry)
            setAmount('');
            setDescription('');

            // Sync list date with just-posted date and refresh
            setListDate(transactionDate);
            fetchTransactions(1);
        } catch (err: unknown) {
            toast({
                title: 'Posting failed',
                description: err instanceof Error ? err.message : 'Unexpected error',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    const selectedBranch = branches.find((b) => b.id === selectedBranchId);
    const isBorrow = transactionType === 'HO_BORROW';

    return (
        <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
            {/* ── Page Header ── */}
            <div className="flex items-start gap-3">
                <div className="p-2.5 bg-primary/10 dark:bg-brand-green-darker/30 rounded-xl shrink-0">
                    <Building2 className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-slate-50">
                        HO Transaction
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        Record Head Office Borrow and HO Remittance (Day Final Amount) transactions.
                        Entries flow into Day Book and Receipts &amp; Payments automatically.
                    </p>
                </div>
            </div>

            {/* ── Transaction Type Selector (prominent visual toggle) ── */}
            <div className="grid grid-cols-2 gap-4 max-w-xl">
                <button
                    type="button"
                    onClick={() => setTransactionType('HO_BORROW')}
                    className={cn(
                        'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
                        isBorrow
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm'
                            : 'border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker hover:border-emerald-300',
                    )}
                >
                    <span className={cn('flex items-center gap-2 font-semibold text-sm', isBorrow ? 'text-emerald-700 dark:text-emerald-400' : 'text-sidebar-accent dark:text-slate-300')}>
                        <ArrowDownToLine className="h-4 w-4" />
                        HO Borrow
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                        Branch receives cash from Head Office
                    </span>
                    {isBorrow && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => setTransactionType('HO_REMITTANCE')}
                    className={cn(
                        'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
                        !isBorrow
                            ? 'border-primary bg-green-50 dark:bg-green-950/30 shadow-sm'
                            : 'border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker hover:border-primary/50',
                    )}
                >
                    <span className={cn('flex items-center gap-2 font-semibold text-sm', !isBorrow ? 'text-sidebar-accent dark:text-primary' : 'text-sidebar-accent dark:text-slate-300')}>
                        <ArrowUpFromLine className="h-4 w-4" />
                        HO Remittance
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                        Branch remits day final amount to HO
                    </span>
                    {!isBorrow && (
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                    )}
                </button>
            </div>

            {/* ── Entry Form ── */}
            <Card className={cn(
                'border-2 shadow-sm',
                isBorrow
                    ? 'border-emerald-100 dark:border-emerald-900'
                    : 'border-primary/20 dark:border-brand-green-darker',
            )}>
                <CardHeader className={cn(
                    'pb-4',
                    isBorrow
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'bg-green-50/50 dark:bg-green-950/20',
                )}>
                    <CardTitle className={cn(
                        'text-base font-semibold flex items-center gap-2',
                        isBorrow ? 'text-emerald-800 dark:text-emerald-200' : 'text-sidebar-accent dark:text-green-200',
                    )}>
                        {isBorrow ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                        {isBorrow ? 'HO Borrow Entry' : 'HO Remittance Entry'}
                    </CardTitle>
                    <CardDescription>
                        {isBorrow
                            ? 'Creates a Cash Receipt (Dr Cash in Hand | Cr HO Borrow).'
                            : 'Creates a Cash Payment (Dr HO Remittance | Cr Cash in Hand).'}
                    </CardDescription>
                </CardHeader>

                <CardContent className="pt-5">
                    <form onSubmit={handleSubmit} noValidate>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">

                            {/* Branch selector — Admin sees dropdown, BM/AM sees read-only badge */}
                            <div className="space-y-1.5">
                                <Label>
                                    Branch
                                    {isAdmin && <span className="text-red-500 ml-0.5">*</span>}
                                </Label>
                                {isAdmin ? (
                                    <Select
                                        value={selectedBranchId}
                                        onValueChange={(v) => { setSelectedBranchId(v); setErrors((e) => ({ ...e, branchId: undefined })); }}
                                        disabled={isBranchesLoading}
                                    >
                                        <SelectTrigger className={cn('h-11', errors.branchId && 'border-red-500')}>
                                            <SelectValue placeholder={isBranchesLoading ? 'Loading branches…' : 'Select branch'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    {b.code} — {b.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="h-11 px-3 flex items-center rounded-md border bg-green-50 dark:bg-sidebar-accent text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                        {selectedBranch ? `${selectedBranch.code} — ${selectedBranch.name}` : '—'}
                                    </div>
                                )}
                                {errors.branchId && (
                                    <p className="text-xs text-red-500">{errors.branchId}</p>
                                )}
                            </div>

                            {/* Transaction Date */}
                            <div className="space-y-1.5">
                                <Label>
                                    Transaction Date
                                    <span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
                                    <DateInput
                                        className={cn('h-11 pl-9', !isDateEditable && 'bg-green-50 dark:bg-sidebar-accent cursor-not-allowed', errors.transactionDate && 'border-red-500')}
                                        value={transactionDate}
                                        onChange={(e) => { if (isDateEditable) { setTransactionDate(e.target.value); setErrors((er) => ({ ...er, transactionDate: undefined })); } }}
                                        readOnly={!isDateEditable}
                                        max={isDateEditable ? undefined : todayISO()}
                                    />
                                </div>
                                {!isDateEditable && (
                                    <p className="text-xs text-slate-400 flex items-center gap-1">
                                        <Info className="h-3 w-3" />
                                        Locked to current working day
                                    </p>
                                )}
                                {errors.transactionDate && (
                                    <p className="text-xs text-red-500">{errors.transactionDate}</p>
                                )}
                            </div>

                            {/* Amount */}
                            <div className="space-y-1.5">
                                <Label>
                                    Amount (₹)
                                    <span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <div className="relative">
                                    <IndianRupee className="absolute left-3 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
                                    <Input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="0.00"
                                        className={cn('h-11 pl-9', errors.amount && 'border-red-500')}
                                        value={amount}
                                        onChange={(e) => { setAmount(e.target.value); setErrors((er) => ({ ...er, amount: undefined })); }}
                                    />
                                </div>
                                {errors.amount && (
                                    <p className="text-xs text-red-500">{errors.amount}</p>
                                )}
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5 md:col-span-2 lg:col-span-1">
                                <Label>Description <span className="text-slate-400 text-xs">(optional)</span></Label>
                                <Textarea
                                    placeholder="Narration or remarks…"
                                    rows={2}
                                    className="resize-none"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    maxLength={500}
                                />
                            </div>
                        </div>

                        {/* Accounting preview */}
                        <div className="mt-5 flex items-center gap-2 rounded-lg bg-green-50 dark:bg-sidebar-accent/60 border border-primary/20 dark:border-sidebar-accent px-4 py-3 text-xs text-sidebar-accent dark:text-slate-400">
                            <ReceiptText className="h-3.5 w-3.5 shrink-0" />
                            <span>
                                {isBorrow
                                    ? 'Posting: Dr Cash in Hand ▸ Cr HO Borrow (Cash Receipt voucher)'
                                    : 'Posting: Dr HO Remittance ▸ Cr Cash in Hand (Cash Payment voucher)'}
                            </span>
                        </div>

                        <div className="mt-5 flex justify-end">
                            <Button
                                type="submit"
                                disabled={isSubmitting || !selectedBranchId}
                                className={cn(
                                    'min-w-[160px] gap-2',
                                    isBorrow
                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                        : 'bg-primary hover:bg-primary text-white',
                                )}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Posting…
                                    </>
                                ) : (
                                    <>
                                        {isBorrow ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                                        Post {isBorrow ? 'HO Borrow' : 'HO Remittance'}
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {/* ── Transaction History ── */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <ReceiptText className="h-4 w-4 text-slate-500" />
                                Transaction History
                                {totalCount > 0 && (
                                    <Badge variant="secondary" className="ml-1 text-xs">
                                        {totalCount}
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription className="text-xs mt-0.5">
                                HO Borrow and HO Remittance entries for the selected branch and date
                            </CardDescription>
                        </div>

                        <div className="flex items-center gap-2">
                            <DateInput
                                className="h-9 text-sm w-40"
                                value={listDate}
                                onChange={(e) => setListDate(e.target.value)}
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9"
                                onClick={() => fetchTransactions(listPage)}
                                title="Refresh"
                            >
                                <RefreshCw className={cn('h-4 w-4', isListLoading && 'animate-spin')} />
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <Separator />

                <CardContent className="p-0">
                    {isListLoading ? (
                        <div className="flex items-center justify-center py-12 gap-3 text-slate-500">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span className="text-sm">Loading transactions…</span>
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                            <ReceiptText className="h-8 w-8 opacity-40" />
                            <p className="text-sm">No HO transactions found for this date</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                            <TableHead className="text-xs font-semibold">Voucher No</TableHead>
                                            <TableHead className="text-xs font-semibold">Date</TableHead>
                                            <TableHead className="text-xs font-semibold">Type</TableHead>
                                            <TableHead className="text-xs font-semibold">Branch</TableHead>
                                            <TableHead className="text-xs font-semibold text-right">Amount (₹)</TableHead>
                                            <TableHead className="text-xs font-semibold">Description</TableHead>
                                            <TableHead className="text-xs font-semibold">Posted By</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {transactions.map((tx) => (
                                            <TableRow key={tx.id} className="text-sm hover:bg-green-50/70 dark:hover:bg-sidebar-accent/40">
                                                <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-400">
                                                    {tx.voucherNo}
                                                </TableCell>
                                                <TableCell className="text-xs whitespace-nowrap">
                                                    {format(new Date(tx.transactionDate), 'dd/MM/yyyy')}
                                                </TableCell>
                                                <TableCell>
                                                    {tx.transactionType === 'HO_BORROW' ? (
                                                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-xs gap-1 font-medium border border-emerald-200 dark:border-emerald-800">
                                                            <ArrowDownToLine className="h-3 w-3" />
                                                            HO Borrow
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/40 dark:text-green-300 text-xs gap-1 font-medium border border-primary/30 dark:border-sidebar-accent">
                                                            <ArrowUpFromLine className="h-3 w-3" />
                                                            HO Remittance
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <span className="font-medium">{tx.branchCode}</span>
                                                    {tx.branchName && (
                                                        <span className="text-slate-400 ml-1">— {tx.branchName}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold tabular-nums">
                                                    {formatCurrency(tx.amount)}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500 max-w-[200px] truncate" title={tx.description}>
                                                    {tx.description || '—'}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500">
                                                    {tx.createdBy}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-sidebar-accent">
                                    <span className="text-xs text-slate-500">
                                        Page {listPage} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8"
                                            disabled={listPage <= 1}
                                            onClick={() => fetchTransactions(listPage - 1)}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8"
                                            disabled={listPage >= totalPages}
                                            onClick={() => fetchTransactions(listPage + 1)}
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
