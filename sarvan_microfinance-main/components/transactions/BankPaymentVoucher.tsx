'use client';

import { useState, useEffect } from 'react';
import { CalendarDays, Save, Trash2, RefreshCw, DollarSign, FileText } from 'lucide-react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { DateInput } from '@/components/ui/date-input';

export interface BankPaymentVoucherData {
    voucherNo: string;
    voucherDate: string;
    amount: string;
    debitAccount: string;
    creditAccount: string;
    narration: string;
}

interface BankPaymentVoucherProps {}

// Mock account data - in real app, fetch from AccountsLedger
const mockAccounts = [
    { id: '1', name: 'CASH IN HAND', type: 'ASSETS' },
    { id: '2', name: 'BANK', type: 'ASSETS' },
    { id: '3', name: 'PSC PRINCIPLE', type: 'LIABILITIES' },
    { id: '4', name: 'PSC INTEREST', type: 'LIABILITIES' },
    { id: '5', name: 'ADVANCE COLLECTIONS', type: 'ASSETS' },
    { id: '6', name: 'OTHER INCOME', type: 'INCOME' },
    { id: '7', name: 'SALARIES', type: 'EXPENSES' },
    { id: '8', name: 'RENT', type: 'EXPENSES' },
    { id: '9', name: 'UTILITIES', type: 'EXPENSES' },
    { id: '10', name: 'OFFICE EXPENSES', type: 'EXPENSES' },
];

export function BankPaymentVoucher({}: BankPaymentVoucherProps) {
    const [formData, setFormData] = useState<BankPaymentVoucherData>({
        voucherNo: '623',
        voucherDate: new Date().toISOString().split('T')[0],
        amount: '',
        debitAccount: '',
        creditAccount: '',
        narration: '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

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

    const handleChange = (field: keyof BankPaymentVoucherData, value: string) => {
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

        toast({
            title: 'Voucher Saved',
            description: `Bank payment voucher #${formData.voucherNo} has been saved successfully.`,
        });

        // Reset form
        handleReset();
        setIsLoading(false);
    };

    const handleReset = () => {
        setFormData({
            voucherNo: '623',
            voucherDate: new Date().toISOString().split('T')[0],
            amount: '',
            debitAccount: '',
            creditAccount: '',
            narration: '',
        });
        toast({
            title: 'Form Reset',
            description: 'All form fields have been cleared.',
        });
    };

    const handleDelete = async () => {
        if (!formData.voucherNo || formData.voucherNo === '623') {
            toast({
                title: 'Cannot Delete',
                description: 'No voucher selected to delete.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 500));

        toast({
            title: 'Voucher Deleted',
            description: `Voucher #${formData.voucherNo} has been deleted.`,
        });

        handleReset();
        setIsLoading(false);
    };

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-5xl">
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Voucher Entry Form */}
                    <Card className="border-primary/20 shadow-lg dark:border-sidebar-accent">
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                    <FileText className="h-5 w-5 text-white" />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <CardTitle className="text-xl font-semibold text-foreground dark:text-white">
                                        Voucher Entry - Bank Payment
                                    </CardTitle>
                                    <CardDescription>
                                        Record bank payments and track outgoing transactions
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {/* Row 1: Voucher Date, Voucher No, Amount */}
                                <div className="grid gap-6 md:grid-cols-3">
                                    {/* Voucher Date */}
                                    <div className="space-y-2">
                                        <Label
                                            htmlFor="voucherDate"
                                            className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                        >
                                            Voucher Date
                                        </Label>
                                        <div className="relative">
                                            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput
                                                id="voucherDate"
                                                value={formData.voucherDate}
                                                onChange={(e) =>
                                                    handleChange('voucherDate', e.target.value)
                                                }
                                                className={cn(
                                                    'h-10 w-full border border-primary/30 pr-9 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
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
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                            )}
                                            placeholder="0.00"
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>

                                {/* Row 2: Debit, Credit, Narration */}
                                <div className="grid gap-6 md:grid-cols-3">
                                    {/* Debit */}
                                    <div className="space-y-2">
                                        <Label
                                            htmlFor="debitAccount"
                                            className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                        >
                                            Debit
                                        </Label>
                                        <Select
                                            value={formData.debitAccount}
                                            onValueChange={(value) =>
                                                handleChange('debitAccount', value)
                                            }
                                        >
                                            <SelectTrigger
                                                id="debitAccount"
                                                className={cn(
                                                    'h-10 w-full border border-primary/30 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                                disabled={isLoading}
                                            >
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {mockAccounts.map((account) => (
                                                    <SelectItem key={account.id} value={account.id}>
                                                        {account.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Credit */}
                                    <div className="space-y-2">
                                        <Label
                                            htmlFor="creditAccount"
                                            className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                        >
                                            Credit
                                        </Label>
                                        <Select
                                            value={formData.creditAccount}
                                            onValueChange={(value) =>
                                                handleChange('creditAccount', value)
                                            }
                                        >
                                            <SelectTrigger
                                                id="creditAccount"
                                                className={cn(
                                                    'h-10 w-full border border-primary/30 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                                disabled={isLoading}
                                            >
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {mockAccounts.map((account) => (
                                                    <SelectItem key={account.id} value={account.id}>
                                                        {account.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Narration */}
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
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                            )}
                                            placeholder="Enter transaction description..."
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex flex-wrap items-center gap-3 border-t border-primary/20 pt-6 dark:border-sidebar-accent">
                                    <Button
                                        type="submit"
                                        disabled={isLoading}
                                        className="h-10 gap-2 bg-primary hover:bg-primary text-white shadow-sm"
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
                                        variant="destructive"
                                        onClick={handleDelete}
                                        disabled={isLoading}
                                        className="h-10 gap-2"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                    </Button>

                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleReset}
                                        disabled={isLoading}
                                        className="h-10 gap-2 border-primary/30 text-sidebar-accent hover:border-primary hover:text-sidebar-accent dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-primary dark:hover:text-green-300"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        Reset
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

