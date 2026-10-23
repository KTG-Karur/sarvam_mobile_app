'use client';

import { useEffect, useState } from 'react';
import { Save, RefreshCw, Trash2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns'; // Fixed import - was 'path'

import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { TransactionBranchField } from '@/components/transactions/TransactionBranchField';
import { DateInput } from '@/components/ui/date-input';

export interface BankReceiptFormData {
    transactionDate: string;
    branchId: string;
    selfAccountId: string;
    ledgerId: string;
    amount: string;
    description: string;
}

export interface BankReceiptEditData {
    id: string;
    voucherNo: string;
    transactionDate: string;
    branchId: string;
    selfAccountId: string;
    ledgerId: string;
    amount: number;
    description?: string | null;
}

interface Option {
    id: string;
    name: string;
}

interface BankReceiptFormProps {
    selfAccounts: Option[];
    ledgers: Array<{ id: string; name: string }>;
    onSave: (data: BankReceiptFormData) => Promise<boolean>;
    isDateEditable: boolean;
    /** When set, the form edits this existing voucher instead of creating a new one. */
    editData?: BankReceiptEditData | null;
    onCancelEdit?: () => void;
}

export function BankReceiptForm({
    selfAccounts,
    ledgers,
    onSave,
    isDateEditable,
    editData,
    onCancelEdit,
}: BankReceiptFormProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const isEditing = !!editData;

    // Initialize form data with eodWorkingDate if available
    const getInitialDate = () => {
        return new Date().toISOString().split('T')[0];
    };

    // Computed once at mount time — the parent remounts this component (via a `key`
    // keyed to editData?.id) whenever a different voucher is opened for editing, so
    // this always reflects the right voucher from the first render.
    const [formData, setFormData] = useState<BankReceiptFormData>(editData ? {
        transactionDate: editData.transactionDate.split('T')[0],
        branchId: editData.branchId,
        selfAccountId: editData.selfAccountId,
        ledgerId: editData.ledgerId,
        amount: String(editData.amount),
        description: editData.description ?? '',
    } : {
        transactionDate: getInitialDate(),
        branchId: '',
        selfAccountId: '',
        ledgerId: '',
        amount: '',
        description: '',
    });

    // Scoped to the form's own branch field so switching branch re-resolves the correct
    // branch's EOD working date instead of staying pinned to the session-active branch.
    const { eodWorkingDate, isLoading: isEodLoading } = useEodWorkingDate(formData.branchId);

    // Update form data when eodWorkingDate changes
    useEffect(() => {
        if (isEditing) return; // editing keeps the voucher's original date, not today's working date
        if (eodWorkingDate && /^\d{4}-\d{2}-\d{2}$/.test(eodWorkingDate)) {
            setFormData((prev) => ({
                ...prev,
                transactionDate: eodWorkingDate,
            }));
        }
    }, [eodWorkingDate, isEditing]);

    const handleChange = (field: keyof BankReceiptFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    if (isEodLoading) {
        return <PageLoader label="Loading EOD working date..." fullScreen={false} />;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.branchId) {
            toast({
                title: 'Validation Error',
                description: 'Please select a Branch.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.selfAccountId) {
            toast({
                title: 'Validation Error',
                description: 'Please select a Debit Account.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.ledgerId) {
            toast({
                title: 'Validation Error',
                description: 'Please select a Credit Account.',
                variant: 'destructive',
            });
            return;
        }

        const amount = parseFloat(formData.amount);
        if (isNaN(amount) || amount <= 0) {
            toast({
                title: 'Validation Error',
                description: 'Please enter a valid positive amount.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.description.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Narration is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const success = await onSave(formData);
            if (success) {
                if (isEditing) {
                    onCancelEdit?.();
                } else {
                    handleReset();
                }
            }
        } catch (error) {
            console.error('Form submission error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const resetDate = eodWorkingDate || new Date().toISOString().split('T')[0];
        setFormData({
            transactionDate: resetDate,
            branchId: '',
            selfAccountId: '',
            ledgerId: '',
            amount: '',
            description: '',
        });
        toast({
            title: 'Form Reset',
            description: 'All form fields have been cleared.',
        });
    };

    // Format date for display
    const displayDate = formData.transactionDate 
        ? format(new Date(formData.transactionDate), 'yyyy-MM-dd')
        : '';

    return (
        <div id="bank-receipt-form" className="rounded-none border border-sidebar-accent bg-white p-0 shadow-lg dark:border-sidebar-accent dark:bg-green-950 overflow-hidden">
            <div className="bg-sidebar-accent px-4 py-2">
                <h3 className="text-sm font-semibold text-white">
                    {isEditing ? `Edit Bank Receipt — ${editData!.voucherNo}` : 'Voucher Entry - Bank Receipt'}
                </h3>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    {/* Branch */}
                    <TransactionBranchField
                        value={formData.branchId}
                        onChange={(branchId) => handleChange('branchId', branchId)}
                        disabled={isEditing}
                    />

                    {/* Voucher Date */}
                    <div className="space-y-1">
                        <Label htmlFor="transactionDate" className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                            Voucher Date
                        </Label>
                        <DateInput
                            id="transactionDate"
                            value={displayDate}
                            onChange={(e) => {
                                if (!isDateEditable) return;
                                handleChange('transactionDate', e.target.value);
                            }}
                            readOnly={!isDateEditable}
                            className={cn(
                                'bg-white h-9 dark:bg-green-950 border-primary/30',
                                !isDateEditable && 'bg-brand-green-tint dark:bg-brand-green-darker cursor-not-allowed'
                            )}
                            required
                        />
                        {eodWorkingDate && (
                            <p className="text-xs text-slate-500 mt-1">
                                Based on EOD working date: {format(new Date(eodWorkingDate), 'dd/MM/yyyy')}
                            </p>
                        )}
                    </div>

                    {/* Voucher No */}
                    <div className="space-y-1">
                        <Label className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                            Voucher No
                        </Label>
                        <Input
                            readOnly
                            disabled
                            value="Auto-generated"
                            className="bg-brand-green-tint h-9 text-slate-500 dark:bg-brand-green-darker dark:text-slate-400 border-primary/30 cursor-not-allowed"
                        />
                    </div>

                    {/* Amount */}
                    <div className="space-y-1">
                        <Label htmlFor="amount" className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                            Amount
                        </Label>
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder=""
                            value={formData.amount}
                            onChange={(e) => handleChange('amount', e.target.value)}
                            className="bg-white h-9 dark:bg-green-950 border-primary/30"
                            required
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {/* Debit Account (Self Account) */}
                    <div className="space-y-1">
                        <Label htmlFor="selfAccount" className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                            Debit
                        </Label>
                        <Select
                            value={formData.selfAccountId}
                            onValueChange={(value) => handleChange('selfAccountId', value)}
                        >
                            <SelectTrigger id="selfAccount" className="bg-white h-9 dark:bg-green-950 border-primary/30">
                                <SelectValue placeholder="-- SELECT --" />
                            </SelectTrigger>
                            <SelectContent>
                                {selfAccounts.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                        {account.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Credit Account (Ledger) */}
                    <div className="space-y-1">
                        <Label htmlFor="ledger" className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                            Credit
                        </Label>
                        <Select
                            value={formData.ledgerId}
                            onValueChange={(value) => handleChange('ledgerId', value)}
                        >
                            <SelectTrigger id="ledger" className="bg-white h-9 dark:bg-green-950 border-primary/30">
                                <SelectValue placeholder="-- SELECT --" />
                            </SelectTrigger>
                            <SelectContent>
                                {ledgers.map((ledger) => (
                                    <SelectItem key={ledger.id} value={ledger.id}>
                                        {ledger.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Narration */}
                <div className="space-y-1">
                    <Label htmlFor="description" className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                        Narration <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => handleChange('description', e.target.value)}
                        placeholder=""
                        className="bg-white dark:bg-green-950 min-h-[60px] border-primary/30"
                    />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2">
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="bg-brand-green-darker hover:bg-sidebar-accent text-white min-w-[80px] h-9 rounded-sm"
                    >
                        {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Save'}
                    </Button>

                    {isEditing ? (
                        <Button
                            type="button"
                            onClick={onCancelEdit}
                            disabled={isLoading}
                            variant="outline"
                            className="min-w-[80px] h-9 rounded-sm"
                        >
                            Cancel
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={handleReset}
                            disabled={isLoading}
                            className="bg-brand-green-darker hover:bg-sidebar-accent text-white min-w-[80px] h-9 rounded-sm border-none"
                        >
                            Reset
                        </Button>
                    )}
                </div>
            </form>
        </div>
    );
}