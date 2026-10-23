'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { Loader2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { TransactionBranchField } from '@/components/transactions/TransactionBranchField';
import { DateInput } from '@/components/ui/date-input';

const formSchema = z.object({
    transactionDate: z.date({
        required_error: "Transaction date is required.",
    }),
    branchId: z.string().min(1, "Please select a branch."),
    selfAccountId: z.string({
        required_error: "Please select a debit account.",
    }),
    ledgerId: z.string({
        required_error: "Please select a credit account.",
    }),
    amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
        message: "Amount must be a positive number.",
    }),
    description: z.string().trim().min(1, "Narration is required."),
});

export type CashReceiptFormData = z.infer<typeof formSchema>;

export interface CashReceiptEditData {
    id: string;
    voucherNo: string;
    transactionDate: string;
    branchId: string;
    selfAccountId: string;
    ledgerId: string;
    amount: number;
    description?: string | null;
}

interface CashReceiptFormProps {
    selfAccounts: { id: string; name: string }[];
    ledgers: { id: string; name: string }[];
    onSave: (data: CashReceiptFormData) => Promise<boolean>;
    isDateEditable: boolean;
    /** When set, the form edits this existing voucher instead of creating a new one. */
    editData?: CashReceiptEditData | null;
    onCancelEdit?: () => void;
}

export function CashReceiptForm({ selfAccounts, ledgers, onSave, isDateEditable, editData, onCancelEdit }: CashReceiptFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isEditing = !!editData;

    const form = useForm<CashReceiptFormData>({
        resolver: zodResolver(formSchema),
        // Computed once at mount time — the parent remounts this component (via a
        // `key` keyed to editData?.id) whenever a different voucher is opened for
        // editing, so this always reflects the right voucher from the first render.
        defaultValues: editData ? {
            transactionDate: new Date(editData.transactionDate),
            branchId: editData.branchId,
            selfAccountId: editData.selfAccountId,
            ledgerId: editData.ledgerId,
            amount: String(editData.amount),
            description: editData.description ?? '',
        } : {
            transactionDate: new Date(),
            branchId: '',
            amount: '',
            description: '',
        },
    });
     // Scoped to the form's own branch field so switching branch re-resolves the correct
     // branch's EOD working date instead of staying pinned to the session-active branch.
     const watchedBranchId = form.watch('branchId');
     const { eodWorkingDate, isLoading: isEodLoading } = useEodWorkingDate(watchedBranchId);
 useEffect(() => {
    if (isEditing) return; // editing keeps the voucher's original date, not today's working date
    if (eodWorkingDate && /^\d{4}-\d{2}-\d{2}$/.test(eodWorkingDate)) {
      const dateObj = new Date(eodWorkingDate);
      form.setValue('transactionDate', dateObj);
    }
  }, [eodWorkingDate, form, isEditing]);

   if (!isEditing && isEodLoading) {
    return (
      <Card className="border-2 border-emerald-100 dark:border-emerald-900 shadow-sm">
        <CardContent className="py-12">
          <PageLoader label="Loading EOD working date..." fullScreen={false} />
        </CardContent>
      </Card>
    );
  }
    async function onSubmit(values: CashReceiptFormData) {
        setIsSubmitting(true);
        const success = await onSave(values);
        setIsSubmitting(false);
        if (success) {
            if (isEditing) {
                onCancelEdit?.();
                return;
            }
            form.reset({
                transactionDate: eodWorkingDate ? new Date(eodWorkingDate) : new Date(),
                branchId: values.branchId,
                amount: '',
                description: '',
                selfAccountId: values.selfAccountId, // Keep selected account for convenience? Or reset? Usually reset.
                ledgerId: '',
            });
        }

    }

    return (
        <Card id="cash-receipt-form" className="border-2 border-emerald-100 dark:border-emerald-900 shadow-sm">
            <CardHeader className="bg-emerald-50/50 dark:bg-emerald-950/20 pb-4">
                <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-2">
                    <Save className="h-5 w-5" />
                    {isEditing ? `Edit Cash Receipt — ${editData!.voucherNo}` : 'New Cash Receipt'}
                </CardTitle>
                <CardDescription>
                    {isEditing
                        ? 'Update this cash receipt. Branch cannot be changed after creation.'
                        : 'Record a cash receipt transaction. Debit: Cash Account, Credit: Ledger Account.'}
                </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {/* Branch Field */}
                            <FormField
                                control={form.control}
                                name="branchId"
                                render={({ field, fieldState }) => (
                                    <FormItem>
                                        <TransactionBranchField
                                            value={field.value}
                                            onChange={field.onChange}
                                            error={fieldState.error?.message}
                                            disabled={isEditing}
                                        />
                                    </FormItem>
                                )}
                            />

                            {/* Date Field */}
                            <FormField
                                control={form.control}
                                name="transactionDate"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Date</FormLabel>
                                        <FormControl>
                                            <DateInput
                                                className="h-11 font-medium"
                                                value={isEditing
                                                    ? (field.value ? format(field.value, 'yyyy-MM-dd') : '')
                                                    : (eodWorkingDate ? format(new Date(eodWorkingDate), 'yyyy-MM-dd') : '')}
                                                onChange={(e) => {
                                                    if (!isDateEditable) return;
                                                    if (isEditing) {
                                                        field.onChange(e.target.value ? new Date(e.target.value) : undefined);
                                                    } else {
                                                        field.onChange(eodWorkingDate ? new Date(eodWorkingDate) : undefined);
                                                    }
                                                }}
                                                readOnly={!isDateEditable}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Debit Account (Self) */}
                            <FormField
                                control={form.control}
                                name="selfAccountId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Debit Account (Cash)</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-11">
                                                    <SelectValue placeholder="Select cash account" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {selfAccounts.map((account) => (
                                                    <SelectItem key={account.id} value={account.id}>
                                                        {account.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Credit Account (Ledger) */}
                            <FormField
                                control={form.control}
                                name="ledgerId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Credit Account (Ledger)</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-11">
                                                    <SelectValue placeholder="Select ledger account" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {ledgers.map((ledger) => (
                                                    <SelectItem key={ledger.id} value={ledger.id}>
                                                        {ledger.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Amount */}
                            <FormField
                                control={form.control}
                                name="amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Amount (₹)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="0.00" {...field} className="h-11 font-medium" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Description */}
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Narration <span className="text-red-500">*</span></FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Enter transaction details..."
                                            className="resize-none"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex justify-end gap-2">
                            {isEditing && (
                                <Button type="button" variant="outline" size="lg" disabled={isSubmitting} onClick={onCancelEdit}>
                                    Cancel
                                </Button>
                            )}
                            <Button type="submit" size="lg" disabled={isSubmitting} className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 text-white">
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save className="mr-2 h-4 w-4" />
                                        {isEditing ? 'Update Transaction' : 'Save Transaction'}
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
