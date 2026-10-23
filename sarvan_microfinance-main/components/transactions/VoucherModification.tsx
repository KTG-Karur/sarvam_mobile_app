'use client';

import { useState, useMemo } from 'react';
import { CalendarDays, Save, Trash2, RefreshCw, DollarSign, FileText, CheckCircle2, Plus, Edit, MoreVertical } from 'lucide-react';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

export interface VoucherData {
    id: string;
    type: string;
    voucherNo: string;
    debit: string;
    credit: string;
    amount: string;
    narration: string;
    voucherDate: string;
}

interface VoucherModificationProps {}

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

// Mock voucher types
const voucherTypes = [
    { value: 'CR', label: 'Cash Receipt' },
    { value: 'CP', label: 'Cash Payment' },
    { value: 'BR', label: 'Bank Receipt' },
    { value: 'BP', label: 'Bank Payment' },
    { value: 'JV', label: 'Journal Voucher' },
    { value: 'CV', label: 'Contra Voucher' },
];

// Mock initial vouchers data
const mockVouchers: VoucherData[] = [
    {
        id: '1',
        type: 'CR',
        voucherNo: '658',
        debit: 'CASH IN HAND',
        credit: 'PSC PRINCIPLE',
        amount: '100000.00',
        narration: 'Being the amount received from Mr.Subash auditor month of Dec 2025',
        voucherDate: '2025-04-12',
    },
    {
        id: '2',
        type: 'CP',
        voucherNo: '623',
        debit: 'SALARIES',
        credit: 'CASH IN HAND',
        amount: '50000.00',
        narration: 'Salary payment for the month of April 2025',
        voucherDate: '2025-04-12',
    },
    {
        id: '3',
        type: 'BR',
        voucherNo: '445',
        debit: 'BANK',
        credit: 'OTHER INCOME',
        amount: '25000.00',
        narration: 'Interest received through bank transfer',
        voucherDate: '2025-04-12',
    },
    {
        id: '4',
        type: 'BP',
        voucherNo: '389',
        debit: 'RENT',
        credit: 'BANK',
        amount: '30000.00',
        narration: 'Office rent payment via bank',
        voucherDate: '2025-04-12',
    },
    {
        id: '5',
        type: 'JV',
        voucherNo: '234',
        debit: 'UTILITIES',
        credit: 'OFFICE EXPENSES',
        amount: '15000.00',
        narration: 'Journal entry for expense reallocation',
        voucherDate: '2025-04-12',
    },
    {
        id: '6',
        type: 'CV',
        voucherNo: '567',
        debit: 'BANK',
        credit: 'CASH IN HAND',
        amount: '75000.00',
        narration: 'Cash deposited to bank account',
        voucherDate: '2025-04-12',
    },
    {
        id: '7',
        type: 'CR',
        voucherNo: '659',
        debit: 'CASH IN HAND',
        credit: 'PSC INTEREST',
        amount: '45000.00',
        narration: 'Interest received from client loan account',
        voucherDate: '2025-04-12',
    },
    {
        id: '8',
        type: 'CP',
        voucherNo: '624',
        debit: 'RENT',
        credit: 'CASH IN HAND',
        amount: '20000.00',
        narration: 'Office rent payment for April 2025',
        voucherDate: '2025-04-12',
    },
    {
        id: '9',
        type: 'BR',
        voucherNo: '446',
        debit: 'BANK',
        credit: 'ADVANCE COLLECTIONS',
        amount: '60000.00',
        narration: 'Advance collection received through bank',
        voucherDate: '2025-04-12',
    },
    {
        id: '10',
        type: 'BP',
        voucherNo: '390',
        debit: 'UTILITIES',
        credit: 'BANK',
        amount: '18000.00',
        narration: 'Utility bills payment via bank transfer',
        voucherDate: '2025-04-12',
    },
    {
        id: '11',
        type: 'JV',
        voucherNo: '235',
        debit: 'OFFICE EXPENSES',
        credit: 'SALARIES',
        amount: '35000.00',
        narration: 'Journal entry for expense adjustment',
        voucherDate: '2025-04-12',
    },
    {
        id: '12',
        type: 'CV',
        voucherNo: '568',
        debit: 'CASH IN HAND',
        credit: 'BANK',
        amount: '40000.00',
        narration: 'Cash withdrawn from bank for office use',
        voucherDate: '2025-04-12',
    },
];

export function VoucherModification({}: VoucherModificationProps) {
    // Use the date from dummy data as default
    const defaultDate = '2025-04-12';
    const [selectedDate, setSelectedDate] = useState(defaultDate);
    const [vouchers, setVouchers] = useState<VoucherData[]>(mockVouchers);
    const [selectedVoucher, setSelectedVoucher] = useState<VoucherData | null>(null);
    const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
    const [isCreateMode, setIsCreateMode] = useState(false);
    const [formData, setFormData] = useState({
        voucherDate: new Date().toISOString().split('T')[0],
        debit: '',
        credit: '',
        amount: '',
        narration: '',
        voucherType: '',
    });
    const [isLoading, setIsLoading] = useState(false);
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

    // Filter vouchers by selected date
    const filteredVouchers = useMemo(() => {
        return vouchers.filter((v) => v.voucherDate === selectedDate);
    }, [vouchers, selectedDate]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedVouchers } = useTableSearch(filteredVouchers);

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

    const handleSelectVoucher = (voucher: VoucherData) => {
        setSelectedVoucher(voucher);
        setIsCreateMode(false);
        setFormData({
            voucherDate: voucher.voucherDate,
            debit: voucher.debit,
            credit: voucher.credit,
            amount: formatAmount(voucher.amount),
            narration: voucher.narration,
            voucherType: voucher.type,
        });
        setIsFormDialogOpen(true);
    };

    const handleEdit = (voucher: VoucherData) => {
        handleSelectVoucher(voucher);
    };

    const handleDeleteClick = (voucher: VoucherData) => {
        setDeleteConfirmation({
            open: true,
            voucherId: voucher.id,
            voucherNo: voucher.voucherNo,
        });
    };

    const handleCreateNew = () => {
        setSelectedVoucher(null);
        setIsCreateMode(true);
        setFormData({
            voucherDate: selectedDate,
            debit: '',
            credit: '',
            amount: '',
            narration: '',
            voucherType: '',
        });
        setIsFormDialogOpen(true);
    };

    const handleDialogClose = () => {
        setIsFormDialogOpen(false);
        setSelectedVoucher(null);
        setIsCreateMode(false);
        handleReset();
    };

    const handleChange = (field: string, value: string) => {
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

        if (!formData.voucherType && isCreateMode) {
            toast({
                title: 'Validation Error',
                description: 'Please select a voucher type.',
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

        if (!formData.debit) {
            toast({
                title: 'Validation Error',
                description: 'Please select a debit account.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.credit) {
            toast({
                title: 'Validation Error',
                description: 'Please select a credit account.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 800));

        if (isCreateMode) {
            // Create new voucher
            const nextVoucherNo = Math.max(...vouchers.map((v) => parseInt(v.voucherNo, 10)), 0) + 1;
            const newVoucher: VoucherData = {
                id: Date.now().toString(),
                type: formData.voucherType,
                voucherNo: nextVoucherNo.toString(),
                debit: formData.debit,
                credit: formData.credit,
                amount: parseAmount(formData.amount),
                narration: formData.narration,
                voucherDate: formData.voucherDate,
            };
            setVouchers([...vouchers, newVoucher]);
            toast({
                title: 'Voucher Created',
                description: `Voucher #${newVoucher.voucherNo} has been created successfully.`,
            });
        } else if (selectedVoucher) {
            // Update existing voucher
            setVouchers(
                vouchers.map((v) =>
                    v.id === selectedVoucher.id
                        ? {
                              ...v,
                              debit: formData.debit,
                              credit: formData.credit,
                              amount: parseAmount(formData.amount),
                              narration: formData.narration,
                              voucherDate: formData.voucherDate,
                          }
                        : v
                )
            );
            toast({
                title: 'Voucher Updated',
                description: `Voucher #${selectedVoucher.voucherNo} has been updated successfully.`,
            });
        }

        handleDialogClose();
        setIsLoading(false);
    };

    const handleReset = () => {
        setFormData({
            voucherDate: selectedDate,
            debit: '',
            credit: '',
            amount: '',
            narration: '',
            voucherType: '',
        });
    };

    const handleDelete = async () => {
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

        if (selectedVoucher?.id === deleteConfirmation.voucherId) {
            handleDialogClose();
        }
    };

    const getVoucherTypeLabel = (type: string) => {
        const voucherType = voucherTypes.find((vt) => vt.value === type);
        return voucherType?.label || type;
    };

    const getVoucherTypeBadgeColor = (type: string) => {
        const colors: Record<string, string> = {
            CR: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
            CP: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
            BR: 'bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/30 dark:text-green-300',
            BP: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
            JV: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
            CV: 'bg-primary/10 text-primary dark:bg-brand-green-darker/30 dark:text-primary',
        };
        return colors[type] || 'bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/30 dark:text-slate-300';
    };

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px]">
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Header */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-3xl font-bold text-foreground dark:text-white">
                                    Voucher Modification
                                </h1>
                                <p className="mt-1 text-sm text-sidebar-accent dark:text-slate-400">
                                    Select and modify existing vouchers by date
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {/* Date Filter and Create Button */}
                        <Card className="border-primary/20 shadow-lg dark:border-sidebar-accent">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 flex-1">
                                        <Label
                                            htmlFor="filterDate"
                                            className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 whitespace-nowrap"
                                        >
                                            Voucher Date
                                        </Label>
                                        <div className="relative flex-1 max-w-xs">
                                            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput
                                                id="filterDate"
                                                value={selectedDate}
                                                onChange={(e) => setSelectedDate(e.target.value)}
                                                className={cn(
                                                    'h-10 w-full border border-primary/30 pr-9 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                            />
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        onClick={handleCreateNew}
                                        className="h-10 gap-2 bg-primary hover:bg-primary text-white shadow-sm"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Create New Voucher
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Vouchers Table */}
                        <Card className="border-primary/20 shadow-lg dark:border-sidebar-accent">
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                                <div className="flex items-center gap-3">
                                    <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                        <FileText className="h-5 w-5 text-white" />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <CardTitle className="text-lg font-semibold text-foreground dark:text-white">
                                            Voucher List
                                        </CardTitle>
                                        <CardDescription>
                                            Select a voucher to modify or delete
                                        </CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            {filteredVouchers.length > 0 && (
                                <div className="px-6 pt-4">
                                    <TableSearchInput
                                        value={tableSearchQuery}
                                        onChange={setTableSearchQuery}
                                        placeholder="Search vouchers..."
                                    />
                                </div>
                            )}
                            <CardContent className="p-0">
                                {filteredVouchers.length === 0 ? (
                                    <div className="p-12 text-center">
                                        <FileText className="mx-auto h-12 w-12 text-slate-400" />
                                        <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                            No vouchers found for the selected date.
                                        </p>
                                    </div>
                                ) : searchedVouchers.length === 0 ? (
                                    <div className="p-12 text-center">
                                        <FileText className="mx-auto h-12 w-12 text-slate-400" />
                                        <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                            No vouchers match your search.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-gradient-to-r from-primary via-primary to-primary text-white">
                                                    <TableHead className="font-semibold text-white">Type</TableHead>
                                                    <TableHead className="font-semibold text-white">Voucher No</TableHead>
                                                    <TableHead className="font-semibold text-white">Debit</TableHead>
                                                    <TableHead className="font-semibold text-white">Credit</TableHead>
                                                    <TableHead className="font-semibold text-white text-right">Amount</TableHead>
                                                    <TableHead className="font-semibold text-white">Narration</TableHead>
                                                    <TableHead className="font-semibold text-white text-center">Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {searchedVouchers.map((voucher, index) => {
                                                    return (
                                                        <TableRow
                                                            key={voucher.id}
                                                            className={cn(
                                                                'transition-all duration-200',
                                                                'hover:bg-green-50/80 dark:hover:bg-brand-green-darker/30',
                                                                index % 2 === 0 && 'bg-white dark:bg-green-950/50'
                                                            )}
                                                        >
                                                            <TableCell>
                                                                <Badge
                                                                    className={cn(
                                                                        'text-xs font-medium',
                                                                        getVoucherTypeBadgeColor(voucher.type)
                                                                    )}
                                                                >
                                                                    {voucher.type}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="font-medium text-foreground dark:text-white">
                                                                {voucher.voucherNo}
                                                            </TableCell>
                                                            <TableCell className="text-sidebar-accent dark:text-slate-200">
                                                                {voucher.debit}
                                                            </TableCell>
                                                            <TableCell className="text-sidebar-accent dark:text-slate-200">
                                                                {voucher.credit}
                                                            </TableCell>
                                                            <TableCell className="text-right font-semibold text-foreground dark:text-white">
                                                                ₹{formatAmount(voucher.amount)}
                                                            </TableCell>
                                                            <TableCell className="max-w-md text-sidebar-accent dark:text-slate-200">
                                                                <p className="truncate">{voucher.narration}</p>
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => handleEdit(voucher)}
                                                                        className="h-8 gap-1.5 text-xs font-medium hover:bg-green-50 hover:border-primary/50 dark:hover:bg-green-950/30"
                                                                    >
                                                                        <Edit className="h-3.5 w-3.5" />
                                                                        Edit
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => handleDeleteClick(voucher)}
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
                </div>
            </div>

            {/* Form Dialog */}
            <Dialog open={isFormDialogOpen} onOpenChange={(open) => !open && handleDialogClose()}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold text-foreground dark:text-white">
                            {isCreateMode ? 'Create New Voucher' : `Modify Voucher #${selectedVoucher?.voucherNo}`}
                        </DialogTitle>
                        <DialogDescription>
                            {isCreateMode
                                ? 'Fill in the details to create a new voucher.'
                                : 'Update the voucher details below.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-6 mt-4">
                        {isCreateMode && (
                            <div className="space-y-2">
                                <Label
                                    htmlFor="voucherType"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Voucher Type
                                </Label>
                                <Select
                                    value={formData.voucherType}
                                    onValueChange={(value) => handleChange('voucherType', value)}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger
                                        id="voucherType"
                                        className={cn(
                                            'h-10 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                    >
                                        <SelectValue placeholder="-- SELECT --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {voucherTypes.map((type) => (
                                            <SelectItem key={type.value} value={type.value}>
                                                {type.label} ({type.value})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="grid gap-6 md:grid-cols-2">
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
                                        onChange={(e) => handleChange('voucherDate', e.target.value)}
                                        className={cn(
                                            'h-10 w-full border border-primary/30 pr-9 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                        disabled={isLoading}
                                    />
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
                                    onChange={(e) => handleChange('amount', e.target.value)}
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

                        <div className="grid gap-6 md:grid-cols-2">
                            {/* Credit */}
                            <div className="space-y-2">
                                <Label
                                    htmlFor="credit"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Credit
                                </Label>
                                <Select
                                    value={formData.credit}
                                    onValueChange={(value) => handleChange('credit', value)}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger
                                        id="credit"
                                        className={cn(
                                            'h-10 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                    >
                                        <SelectValue placeholder="-- SELECT --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {mockAccounts.map((account) => (
                                            <SelectItem key={account.id} value={account.name}>
                                                {account.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Debit */}
                            <div className="space-y-2">
                                <Label
                                    htmlFor="debit"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Debit
                                </Label>
                                <Select
                                    value={formData.debit}
                                    onValueChange={(value) => handleChange('debit', value)}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger
                                        id="debit"
                                        className={cn(
                                            'h-10 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                    >
                                        <SelectValue placeholder="-- SELECT --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {mockAccounts.map((account) => (
                                            <SelectItem key={account.id} value={account.name}>
                                                {account.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
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
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) =>
                    setDeleteConfirmation((prev) => ({ ...prev, open }))
                }
                onConfirm={handleDelete}
                title="Delete Voucher"
                description={`Are you sure you want to delete voucher #${deleteConfirmation.voucherNo}? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}

