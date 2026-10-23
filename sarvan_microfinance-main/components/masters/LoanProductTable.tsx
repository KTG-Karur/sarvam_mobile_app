'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CreditCard, Eye, Trash2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface LoanProductRow {
    id: string;
    productId: string;
    productName: string;
    loanProductTypeId: string;
    loanProductTypeName: string;
    loanAmount: string;
    interestRate: string;
    frequency: string;
    numberOfDues: string;
    interestAmount: string;
    loginStatus: string;
    advanceSavingsAmount?: string;
}

interface LoanProductTableProps {
    data: LoanProductRow[];
    isLoading?: boolean;
    onPreview?: (productId: string) => void;
    onDelete?: (productId: string) => void;
    /** Total rows across all pages (defaults to data.length when pagination isn't used). */
    totalCount?: number;
    page?: number;
    totalPages?: number;
    onPageChange?: (page: number) => void;
}

const frequencyLabels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    forthnight: 'ForthNight',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
};

export function LoanProductTable({
    data,
    isLoading,
    onPreview,
    onDelete,
    totalCount,
    page = 1,
    totalPages = 1,
    onPageChange,
}: LoanProductTableProps) {
    if (isLoading) {
        return (
            <div className="mt-6 rounded-2xl border border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <Loader2 className="mx-auto h-8 w-8 text-primary animate-spin" />
                <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                    Loading loan products...
                </p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="mt-6 rounded-2xl border border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CreditCard className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                    No loan products found. Create a new loan product using the form above.
                </p>
            </div>
        );
    }

    return (
        <div className="mt-6 overflow-hidden rounded-[2rem] border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
            <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Loan Products Registry</h3>
                <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                    {totalCount ?? data.length} Records
                </Badge>
            </div>
            <div className="max-h-[520px] overflow-auto">
                <Table className="min-w-full text-xs">
                    <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0 z-10">
                        <TableRow className="hover:bg-primary/80">
                            <TableHead className="px-4 py-3 font-semibold text-white">Product ID</TableHead>
                            <TableHead className="px-4 py-3 font-semibold text-white">Product Name</TableHead>
                            <TableHead className="px-4 py-3 font-semibold text-white">Product Type Name</TableHead>
                            <TableHead className="px-4 py-3 text-right font-semibold text-white">Loan Amount</TableHead>
                            <TableHead className="px-4 py-3 text-center font-semibold text-white">Interest</TableHead>
                            <TableHead className="px-4 py-3 text-center font-semibold text-white">Frequency</TableHead>
                            <TableHead className="px-4 py-3 text-center font-semibold text-white">Dues</TableHead>
                            <TableHead className="px-4 py-3 text-right font-semibold text-white">Total Interest</TableHead>
                            <TableHead className="px-4 py-3 text-right font-semibold text-white">Loan Advance</TableHead>
                            <TableHead className="px-4 py-3 text-center font-semibold text-white">Status</TableHead>
                            <TableHead className="px-4 py-3 text-center font-semibold text-white">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="bg-white dark:bg-green-950/30">
                        {data.map((row) => (
                            <TableRow
                                key={row.id}
                                className="bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80"
                            >
                                <TableCell className="px-4 py-3 font-medium text-foreground dark:text-slate-100">
                                    {row.productId}
                                </TableCell>
                                <TableCell className="px-4 py-3 font-medium text-sidebar-accent dark:text-slate-200">
                                    {row.productName}
                                </TableCell>
                                <TableCell className="px-4 py-3 font-medium text-sidebar-accent dark:text-slate-200">
                                    {row.loanProductTypeName}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right font-mono text-sidebar-accent dark:text-slate-200">
                                    {row.loanAmount}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-center text-sidebar-accent dark:text-slate-300">
                                    {row.interestRate}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-center">
                                    <Badge variant="outline" className="text-[10px] font-medium border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-primary">
                                        {frequencyLabels[row.frequency] || row.frequency}
                                    </Badge>
                                </TableCell>
                                <TableCell className="px-4 py-3 text-center font-medium text-sidebar-accent dark:text-slate-200">
                                    {row.numberOfDues}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right font-mono text-sidebar-accent dark:text-slate-200">
                                    {row.interestAmount}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right font-mono text-sidebar-accent dark:text-slate-200">
                                    {row.advanceSavingsAmount || '₹0'}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-center">
                                    <Badge
                                        variant="outline"
                                        className={row.loginStatus === 'enabled'
                                            ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                                            : 'border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400'}
                                    >
                                        {row.loginStatus === 'enabled' ? 'Enabled' : 'Disabled'}
                                    </Badge>
                                </TableCell>
                                <TableCell className="px-4 py-3">
                                    <div className="flex items-center justify-center gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onPreview && onPreview(row.productId)}
                                            className="h-7 w-7 p-0 border-primary/30 text-primary hover:bg-green-50 hover:border-primary dark:border-sidebar-accent dark:text-primary dark:hover:bg-green-950/30"
                                            title="Preview"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onDelete && onDelete(row.productId)}
                                            className="h-7 w-7 p-0 border-primary/30 text-red-600 hover:bg-red-50 hover:border-red-400 dark:border-sidebar-accent dark:text-red-400 dark:hover:bg-red-950/30"
                                            title="Delete"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-4 py-3">
                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                        Page {page} of {totalPages} · {totalCount ?? data.length} record{(totalCount ?? data.length) !== 1 ? 's' : ''}
                    </p>
                    <div className="flex gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onPageChange?.(Math.max(1, page - 1))}
                            disabled={page === 1}
                        >
                            Previous
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
                            disabled={page === totalPages}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
