'use client';

import { useState, useMemo, useEffect } from 'react';
import { CalendarDays, Save, Trash2, RefreshCw, Search, X, FileText, Edit, DollarSign, TrendingUp, CheckCircle2 } from 'lucide-react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

export interface CashReceiptVoucherData {
    id?: string;
    voucherNo: string;
    voucherDate: string;
    amount: string;
    debitAccount: string;
    creditAccount: string;
    narration: string;
}

interface CashReceiptVoucherProps {}

// Mock account data - in real app, fetch from AccountsLedger
const mockAccounts = [
    { id: '1', name: 'CASH IN HAND', type: 'ASSETS' },
    { id: '2', name: 'BANK', type: 'ASSETS' },
    { id: '3', name: 'PSC PRINCIPLE', type: 'LIABILITIES' },
    { id: '4', name: 'PSC INTEREST', type: 'LIABILITIES' },
    { id: '5', name: 'ADVANCE COLLECTIONS', type: 'ASSETS' },
    { id: '6', name: 'OTHER INCOME', type: 'INCOME' },
];

// Mock initial vouchers data
const mockVouchers: CashReceiptVoucherData[] = [
    {
        id: '1',
        voucherNo: '658',
        voucherDate: '2025-04-12',
        amount: '100000.00',
        debitAccount: '1',
        creditAccount: '3',
        narration: 'Being the amount received from Mr.Subash auditor month of Dec 2025',
    },
    {
        id: '2',
        voucherNo: '657',
        voucherDate: '2025-04-11',
        amount: '50000.00',
        debitAccount: '1',
        creditAccount: '4',
        narration: 'Interest received from client loan account',
    },
    {
        id: '3',
        voucherNo: '656',
        voucherDate: '2025-04-10',
        amount: '25000.00',
        debitAccount: '2',
        creditAccount: '6',
        narration: 'Other income received through bank transfer',
    },
    {
        id: '4',
        voucherNo: '655',
        voucherDate: '2025-04-09',
        amount: '75000.00',
        debitAccount: '1',
        creditAccount: '3',
        narration: 'Principal amount collected from member account',
    },
    {
        id: '5',
        voucherNo: '654',
        voucherDate: '2025-04-08',
        amount: '30000.00',
        debitAccount: '1',
        creditAccount: '5',
        narration: 'Advance collection from new member registration',
    },
    {
        id: '6',
        voucherNo: '653',
        voucherDate: '2025-04-07',
        amount: '150000.00',
        debitAccount: '2',
        creditAccount: '3',
        narration: 'Bulk principal collection deposited to bank',
    },
    {
        id: '7',
        voucherNo: '652',
        voucherDate: '2025-04-06',
        amount: '45000.00',
        debitAccount: '1',
        creditAccount: '4',
        narration: 'Monthly interest collection from multiple accounts',
    },
    {
        id: '8',
        voucherNo: '651',
        voucherDate: '2025-04-05',
        amount: '60000.00',
        debitAccount: '1',
        creditAccount: '6',
        narration: 'Service charges and fees collected',
    },
    {
        id: '9',
        voucherNo: '650',
        voucherDate: '2025-04-04',
        amount: '85000.00',
        debitAccount: '2',
        creditAccount: '3',
        narration: 'Principal repayment received via bank transfer',
    },
    {
        id: '10',
        voucherNo: '649',
        voucherDate: '2025-04-03',
        amount: '35000.00',
        debitAccount: '1',
        creditAccount: '5',
        narration: 'Advance payment for upcoming loan disbursement',
    },
];

export function CashReceiptVoucher({}: CashReceiptVoucherProps) {
    const [formData, setFormData] = useState<CashReceiptVoucherData>({
        voucherNo: '',
        voucherDate: new Date().toISOString().split('T')[0],
        amount: '',
        debitAccount: '',
        creditAccount: '',
        narration: '',
    });
    const [vouchers, setVouchers] = useState<CashReceiptVoucherData[]>(mockVouchers);
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
    const [editingVoucher, setEditingVoucher] = useState<CashReceiptVoucherData | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        voucherId: string | null;
        voucherNo: string;
    }>({
        open: false,
        voucherId: null,
        voucherNo: '',
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    // Generate next voucher number
    const nextVoucherNo = useMemo(() => {
        if (vouchers.length === 0) return '658';
        const maxNo = Math.max(...vouchers.map((v) => parseInt(v.voucherNo, 10)));
        return (maxNo + 1).toString();
    }, [vouchers]);

    // Initialize voucher number
    useEffect(() => {
        if (!formData.voucherNo && !editingVoucher) {
            setFormData((prev) => ({ ...prev, voucherNo: nextVoucherNo }));
        }
    }, [nextVoucherNo, formData.voucherNo, editingVoucher]);

    // Load editing voucher data into form
    useEffect(() => {
        if (editingVoucher) {
            setFormData({
                voucherNo: editingVoucher.voucherNo,
                voucherDate: editingVoucher.voucherDate,
                amount: formatAmount(editingVoucher.amount),
                debitAccount: editingVoucher.debitAccount,
                creditAccount: editingVoucher.creditAccount,
                narration: editingVoucher.narration,
            });
        }
    }, [editingVoucher]);

    // Format amount with commas
    const formatAmount = (value: string): string => {
        const numericValue = value.replace(/[^0-9.]/g, '');
        if (!numericValue) return '';
        const parts = numericValue.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.length > 1 ? `${parts[0]}.${parts[1].slice(0, 2)}` : parts[0];
    };

    // Parse amount from formatted string
    const parseAmount = (value: string): string => {
        return value.replace(/,/g, '');
    };

    const handleChange = (field: keyof CashReceiptVoucherData, value: string) => {
        if (field === 'amount') {
            setFormData((prev) => ({ ...prev, [field]: formatAmount(value) }));
        } else {
            setFormData((prev) => ({ ...prev, [field]: value }));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!formData.voucherDate) {
            toast({
                title: 'Validation Error',
                description: 'Please select a voucher date.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.amount || parseFloat(parseAmount(formData.amount)) <= 0) {
            toast({
                title: 'Validation Error',
                description: 'Please enter a valid amount.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.debitAccount) {
            toast({
                title: 'Validation Error',
                description: 'Please select a debit account.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.creditAccount) {
            toast({
                title: 'Validation Error',
                description: 'Please select a credit account.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 800));

        const voucherData: CashReceiptVoucherData = {
            ...formData,
            amount: parseAmount(formData.amount),
        };

        if (editingVoucher) {
            // Update existing voucher
            setVouchers(
                vouchers.map((v) =>
                    v.id === editingVoucher.id ? { ...voucherData, id: editingVoucher.id } : v
                )
            );
            toast({
                title: 'Voucher Updated',
                description: `Cash receipt voucher #${formData.voucherNo} has been updated successfully.`,
            });
        } else {
            // Create new voucher
            const newVoucher: CashReceiptVoucherData = {
                ...voucherData,
                id: Date.now().toString(),
            };
            setVouchers([newVoucher, ...vouchers]);
            toast({
                title: 'Voucher Saved',
                description: `Cash receipt voucher #${formData.voucherNo} has been saved successfully.`,
            });
        }

        // Reset form and close dialog
        handleDialogClose();
        setIsLoading(false);
    };

    const handleReset = () => {
        setFormData({
            voucherNo: nextVoucherNo,
            voucherDate: new Date().toISOString().split('T')[0],
            amount: '',
            debitAccount: '',
            creditAccount: '',
            narration: '',
        });
        setEditingVoucher(null);
    };

    const handleCreateNew = () => {
        setEditingVoucher(null);
        handleReset();
        setIsFormDialogOpen(true);
    };

    const handleEdit = (voucherId: string) => {
        const voucher = vouchers.find((v) => v.id === voucherId);
        if (voucher) {
            setEditingVoucher(voucher);
            setIsFormDialogOpen(true);
        }
    };

    const handleDialogClose = () => {
        setIsFormDialogOpen(false);
        setEditingVoucher(null);
        handleReset();
    };

    const handleDeleteClick = (voucherId: string) => {
        const voucher = vouchers.find((v) => v.id === voucherId);
        if (voucher) {
            setDeleteConfirmation({
                open: true,
                voucherId,
                voucherNo: voucher.voucherNo,
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.voucherId) {
            return;
        }

        setIsDeleting(true);
        await new Promise((resolve) => setTimeout(resolve, 800));

        setVouchers(vouchers.filter((v) => v.id !== deleteConfirmation.voucherId));
        
        toast({
            title: 'Voucher Deleted',
            description: `Voucher #${deleteConfirmation.voucherNo} has been deleted successfully.`,
        });

        setIsDeleting(false);
        setDeleteConfirmation({
            open: false,
            voucherId: null,
            voucherNo: '',
        });
    };

    // Filter vouchers
    const filteredVouchers = useMemo(() => {
        if (!searchQuery) return vouchers;
        const query = searchQuery.toLowerCase();
        return vouchers.filter(
            (v) =>
                v.voucherNo.toLowerCase().includes(query) ||
                v.debitAccount.toLowerCase().includes(query) ||
                v.creditAccount.toLowerCase().includes(query) ||
                v.narration.toLowerCase().includes(query)
        );
    }, [vouchers, searchQuery]);

    // Calculate totals
    const totalAmount = useMemo(() => {
        return filteredVouchers.reduce((sum, v) => sum + parseFloat(v.amount || '0'), 0);
    }, [filteredVouchers]);

    // Filter accounts for search
    const [debitSearchQuery, setDebitSearchQuery] = useState('');
    const [creditSearchQuery, setCreditSearchQuery] = useState('');

    const filteredDebitAccounts = useMemo(() => {
        if (!debitSearchQuery) return mockAccounts;
        const query = debitSearchQuery.toLowerCase();
        return mockAccounts.filter(
            (acc) => acc.name.toLowerCase().includes(query) || acc.type.toLowerCase().includes(query)
        );
    }, [debitSearchQuery]);

    const filteredCreditAccounts = useMemo(() => {
        if (!creditSearchQuery) return mockAccounts;
        const query = creditSearchQuery.toLowerCase();
        return mockAccounts.filter(
            (acc) => acc.name.toLowerCase().includes(query) || acc.type.toLowerCase().includes(query)
        );
    }, [creditSearchQuery]);

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px]">
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-green-500/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
                    </div>

                    {/* Header */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-3xl font-bold text-foreground dark:text-white">
                                    Cash Receipt Voucher
                                </h1>
                                <p className="mt-1 text-sm text-sidebar-accent dark:text-slate-400">
                                    Record cash receipts and track financial transactions
                                </p>
                            </div>
                            <Badge variant="outline" className="h-8 px-3 text-sm">
                                <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />
                                {vouchers.length} Voucher{vouchers.length !== 1 ? 's' : ''}
                            </Badge>
                        </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                        {/* Main Content */}
                        <div className="space-y-6">
                            {/* Create New Button */}
                            <Card className="border-primary/20 shadow-lg dark:border-sidebar-accent">
                                <CardContent className="pt-6">
                                    <Button
                                        type="button"
                                        onClick={handleCreateNew}
                                        className="h-10 gap-2 bg-green-600 hover:bg-green-700 text-white shadow-sm"
                                    >
                                        <FileText className="h-4 w-4" />
                                        Create New Voucher
                                    </Button>
                                </CardContent>
                            </Card>

                            {/* Voucher Entry Form - Now in Modal */}
                            <Dialog open={isFormDialogOpen} onOpenChange={(open) => !open && handleDialogClose()}>
                                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                        <DialogTitle className="text-xl font-semibold text-foreground dark:text-white">
                                            {editingVoucher ? 'Edit Cash Receipt Voucher' : 'Create New Cash Receipt Voucher'}
                                        </DialogTitle>
                                        <DialogDescription>
                                            {editingVoucher
                                                ? 'Update the voucher details below.'
                                                : 'Enter transaction details for cash receipt'}
                                        </DialogDescription>
                                    </DialogHeader>
                                    <form onSubmit={handleSubmit} className="space-y-6 mt-4">
                                        {/* Transaction Details Section */}
                                        <div className="space-y-4">
                                            <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                Transaction Details
                                            </h3>
                                            <div className="grid gap-4 md:grid-cols-3">
                                                {/* Voucher Date */}
                                                <div className="space-y-2">
                                                    <Label
                                                        htmlFor="voucherDate"
                                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                                    >
                                                        Voucher Date
                                                    </Label>
                                                    <div className="relative">
                                                        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                        <DateInput
                                                            id="voucherDate"
                                                            value={formData.voucherDate}
                                                            onChange={(e) =>
                                                                handleChange('voucherDate', e.target.value)
                                                            }
                                                            className={cn(
                                                                'h-10 w-full border border-primary/30 pl-9 text-sm font-medium',
                                                                'bg-green-50 hover:border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20',
                                                                'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                            )}
                                                            disabled={isLoading}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Voucher No */}
                                                <div className="space-y-2">
                                                    <Label
                                                        htmlFor="voucherNo"
                                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                                    >
                                                        Voucher No
                                                    </Label>
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            id="voucherNo"
                                                            type="text"
                                                            value={formData.voucherNo}
                                                            readOnly
                                                            className={cn(
                                                                'h-10 w-full border border-primary/30 text-sm font-medium',
                                                                'bg-brand-green-tint cursor-not-allowed',
                                                                'dark:bg-sidebar-accent dark:border-sidebar-accent'
                                                            )}
                                                        />
                                                        <Badge variant="secondary" className="text-xs">
                                                            Auto
                                                        </Badge>
                                                    </div>
                                                </div>

                                                {/* Amount */}
                                                <div className="space-y-2">
                                                    <Label
                                                        htmlFor="amount"
                                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-1"
                                                    >
                                                        <DollarSign className="h-3.5 w-3.5" />
                                                        Amount
                                                    </Label>
                                                    <Input
                                                        id="amount"
                                                        type="text"
                                                        value={formData.amount}
                                                        onChange={(e) =>
                                                            handleChange('amount', e.target.value)
                                                        }
                                                        className={cn(
                                                            'h-10 w-full border border-primary/30 text-sm font-medium',
                                                            'bg-green-50 hover:border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20',
                                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                        )}
                                                        placeholder="0.00"
                                                        disabled={isLoading}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Accounts Section */}
                                        <div className="space-y-4">
                                            <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                Accounts
                                            </h3>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                {/* Debit Account */}
                                                <div className="space-y-2">
                                                    <Label
                                                        htmlFor="debitAccount"
                                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                                    >
                                                        Debit
                                                    </Label>
                                                    <Select
                                                        value={formData.debitAccount}
                                                        onValueChange={(value) => {
                                                            handleChange('debitAccount', value);
                                                            setDebitSearchQuery('');
                                                        }}
                                                    >
                                                        <SelectTrigger
                                                            id="debitAccount"
                                                            className={cn(
                                                                'h-10 w-full border border-primary/30 text-sm font-medium',
                                                                'bg-green-50 hover:border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20',
                                                                'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                            )}
                                                            disabled={isLoading}
                                                        >
                                                            <SelectValue placeholder="Select debit account" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <div className="p-2">
                                                                <Input
                                                                    placeholder="Search accounts..."
                                                                    value={debitSearchQuery}
                                                                    onChange={(e) =>
                                                                        setDebitSearchQuery(e.target.value)
                                                                    }
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                            {filteredDebitAccounts.map((account) => (
                                                                <SelectItem key={account.id} value={account.id}>
                                                                    <div className="flex items-center justify-between w-full">
                                                                        <span>{account.name}</span>
                                                                        <Badge variant="outline" className="ml-2 text-xs">
                                                                            {account.type}
                                                                        </Badge>
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Credit Account */}
                                                <div className="space-y-2">
                                                    <Label
                                                        htmlFor="creditAccount"
                                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                                    >
                                                        Credit
                                                    </Label>
                                                    <Select
                                                        value={formData.creditAccount}
                                                        onValueChange={(value) => {
                                                            handleChange('creditAccount', value);
                                                            setCreditSearchQuery('');
                                                        }}
                                                    >
                                                        <SelectTrigger
                                                            id="creditAccount"
                                                            className={cn(
                                                                'h-10 w-full border border-primary/30 text-sm font-medium',
                                                                'bg-green-50 hover:border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20',
                                                                'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                            )}
                                                            disabled={isLoading}
                                                        >
                                                            <SelectValue placeholder="Select credit account" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <div className="p-2">
                                                                <Input
                                                                    placeholder="Search accounts..."
                                                                    value={creditSearchQuery}
                                                                    onChange={(e) =>
                                                                        setCreditSearchQuery(e.target.value)
                                                                    }
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                            {filteredCreditAccounts.map((account) => (
                                                                <SelectItem key={account.id} value={account.id}>
                                                                    <div className="flex items-center justify-between w-full">
                                                                        <span>{account.name}</span>
                                                                        <Badge variant="outline" className="ml-2 text-xs">
                                                                            {account.type}
                                                                        </Badge>
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Narration Section */}
                                        <div className="space-y-2">
                                            <Label
                                                htmlFor="narration"
                                                className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                            >
                                                Narration
                                            </Label>
                                            <Textarea
                                                id="narration"
                                                value={formData.narration}
                                                onChange={(e) => handleChange('narration', e.target.value)}
                                                className={cn(
                                                    'min-h-24 w-full border border-primary/30 text-sm',
                                                    'bg-green-50 hover:border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                                placeholder="Enter transaction description..."
                                                disabled={isLoading}
                                                maxLength={500}
                                            />
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {formData.narration.length}/500 characters
                                            </p>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex flex-wrap items-center gap-3 border-t border-primary/20 pt-4 dark:border-sidebar-accent">
                                            <Button
                                                type="submit"
                                                disabled={isLoading}
                                                className="h-10 gap-2 bg-green-600 hover:bg-green-700 text-white shadow-sm"
                                            >
                                                {isLoading ? (
                                                    <>
                                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                                        Saving...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Save className="h-4 w-4" />
                                                        Save
                                                    </>
                                                )}
                                            </Button>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={handleReset}
                                                disabled={isLoading}
                                                className="h-10 gap-2"
                                            >
                                                <RefreshCw className="h-4 w-4" />
                                                Reset
                                            </Button>
                                        </div>
                                    </form>
                                </DialogContent>
                            </Dialog>

                            {/* Voucher List Table */}
                            <Card className="border-primary/20 shadow-lg dark:border-sidebar-accent">
                                <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-brand-green-darker dark:to-sidebar-accent">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-lg text-foreground dark:text-white">
                                                Voucher History
                                            </CardTitle>
                                            <CardDescription>
                                                View and manage cash receipt vouchers
                                            </CardDescription>
                                        </div>
                                        <div className="relative w-64">
                                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input
                                                type="text"
                                                placeholder="Search vouchers..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="h-9 pl-9 pr-9"
                                            />
                                            {searchQuery && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setSearchQuery('')}
                                                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {filteredVouchers.length === 0 ? (
                                        <div className="p-12 text-center">
                                            <FileText className="mx-auto h-12 w-12 text-slate-400" />
                                            <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                                {searchQuery
                                                    ? 'No vouchers found matching your search.'
                                                    : 'No vouchers yet. Create your first cash receipt voucher above.'}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-sidebar-accent dark:to-brand-green-darker/50">
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 w-[100px]">
                                                            Voucher No
                                                        </TableHead>
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 w-[110px]">
                                                            Date
                                                        </TableHead>
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 min-w-[180px]">
                                                            Debit Account
                                                        </TableHead>
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 min-w-[180px]">
                                                            Credit Account
                                                        </TableHead>
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 text-right w-[130px]">
                                                            Amount
                                                        </TableHead>
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 min-w-[280px]">
                                                            Narration
                                                        </TableHead>
                                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-300 text-center w-[200px]">
                                                            Actions
                                                        </TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {filteredVouchers.map((voucher, index) => {
                                                        const debitAccount = mockAccounts.find(
                                                            (a) => a.id === voucher.debitAccount
                                                        );
                                                        const creditAccount = mockAccounts.find(
                                                            (a) => a.id === voucher.creditAccount
                                                        );
                                                        const amount = parseFloat(voucher.amount || '0');
                                                        return (
                                                            <TableRow
                                                                key={voucher.id}
                                                                className={cn(
                                                                    'transition-all duration-200 border-b border-slate-100 dark:border-sidebar-accent',
                                                                    'hover:bg-green-50/80 dark:hover:bg-brand-green-darker/30',
                                                                    index % 2 === 0 && 'bg-white dark:bg-green-950/50'
                                                                )}
                                                            >
                                                                <TableCell className="py-4">
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="font-semibold text-foreground dark:text-white">
                                                                            #{voucher.voucherNo}
                                                                        </span>
                                                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                            ID: {voucher.id?.slice(-6)}
                                                                        </span>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="py-4">
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="font-medium text-foreground dark:text-white">
                                                                            {toDisplayDate(new Date(voucher.voucherDate))}
                                                                        </span>
                                                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                            {new Date(voucher.voucherDate).toLocaleDateString('en-US', { weekday: 'short' })}
                                                                        </span>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="py-4">
                                                                    <div className="flex flex-col gap-2">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="h-2 w-2 rounded-full bg-primary" />
                                                                            <span className="font-medium text-foreground dark:text-white">
                                                                                {debitAccount?.name || 'N/A'}
                                                                            </span>
                                                                        </div>
                                                                        <Badge 
                                                                            variant="outline" 
                                                                            className="text-xs w-fit border-primary/30 text-sidebar-accent dark:border-brand-green-darker dark:text-green-300"
                                                                        >
                                                                            {debitAccount?.type || 'N/A'}
                                                                        </Badge>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="py-4">
                                                                    <div className="flex flex-col gap-2">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="h-2 w-2 rounded-full bg-purple-500" />
                                                                            <span className="font-medium text-foreground dark:text-white">
                                                                                {creditAccount?.name || 'N/A'}
                                                                            </span>
                                                                        </div>
                                                                        <Badge 
                                                                            variant="outline" 
                                                                            className="text-xs w-fit border-purple-200 text-purple-700 dark:border-purple-900 dark:text-purple-300"
                                                                        >
                                                                            {creditAccount?.type || 'N/A'}
                                                                        </Badge>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="py-4 text-right">
                                                                    <div className="flex flex-col items-end gap-1">
                                                                        <span className="font-bold text-lg text-green-700 dark:text-green-400">
                                                                            ₹{formatAmount(voucher.amount)}
                                                                        </span>
                                                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                            {amount >= 100000 ? 'Large' : amount >= 50000 ? 'Medium' : 'Small'}
                                                                        </span>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="py-4">
                                                                    <div className="max-w-[280px]">
                                                                        <p className="text-sm text-sidebar-accent dark:text-slate-300 line-clamp-2">
                                                                            {voucher.narration || 'No description'}
                                                                        </p>
                                                                        {voucher.narration && voucher.narration.length > 60 && (
                                                                            <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">
                                                                                {voucher.narration.length} chars
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="py-4">
                                                                    <div className="flex items-center justify-center gap-2">
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="sm"
                                                                            onClick={() => handleEdit(voucher.id!)}
                                                                            className="h-8 gap-1.5 text-xs font-medium hover:bg-green-50 hover:border-primary/50 dark:hover:bg-green-950/30"
                                                                        >
                                                                            <Edit className="h-3.5 w-3.5" />
                                                                            Edit
                                                                        </Button>
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="sm"
                                                                            onClick={() => handleDeleteClick(voucher.id!)}
                                                                            className="h-8 gap-1.5 text-xs font-medium hover:bg-red-50 hover:border-red-300 hover:text-red-600 dark:hover:bg-red-950/30"
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                            Delete
                                                                        </Button>
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Summary Sidebar */}
                        <div className="space-y-6">
                            <Card className="border-primary/20 shadow-lg dark:border-sidebar-accent">
                                <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20">
                                    <CardTitle className="flex items-center gap-2 text-lg text-foreground dark:text-white">
                                        <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                                        Summary
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-green-50 p-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                                            <div>
                                                <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                                    Total Vouchers
                                                </p>
                                                <p className="mt-1 text-2xl font-bold text-foreground dark:text-white">
                                                    {filteredVouchers.length}
                                                </p>
                                            </div>
                                            <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/30">
                                                <FileText className="h-6 w-6 text-green-600 dark:text-green-400" />
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900/50 dark:bg-green-950/20">
                                            <div>
                                                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                                                    Total Amount
                                                </p>
                                                <p className="mt-1 text-2xl font-bold text-green-900 dark:text-green-100">
                                                    {formatAmount(totalAmount.toFixed(2))}
                                                </p>
                                            </div>
                                            <div className="rounded-full bg-green-200 p-3 dark:bg-green-900/50">
                                                <DollarSign className="h-6 w-6 text-green-700 dark:text-green-300" />
                                            </div>
                                        </div>

                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) =>
                    setDeleteConfirmation((prev) => ({ ...prev, open }))
                }
                onConfirm={handleDeleteConfirm}
                title="Delete Cash Receipt Voucher"
                description={`Are you sure you want to delete voucher #${deleteConfirmation.voucherNo}? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}

