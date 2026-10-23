'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { BookOpen, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { LoanPassbookDialog } from '@/components/loan-module/LoanPassbookDialog';
import { PageLoader } from '@/components/ui/page-loader';

type IndexLoan = {
    id: string;
    loanNumber: string;
    clientId: string;
    clientName: string;
    amount: number;
    frequency: string;
    disbursementStatus: string;
};

interface IndexPassbookDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    indexId: string;
    indexNo: string;
}

export function IndexPassbookDialog({ open, onOpenChange, indexId, indexNo }: IndexPassbookDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [loans, setLoans] = useState<IndexLoan[]>([]);
    const [previewLoan, setPreviewLoan] = useState<IndexLoan | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (open && indexId) {
            fetchLoans();
        }
    }, [open, indexId]);

    const fetchLoans = async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<IndexLoan[]>(`/loan-indexes/${indexId}/loans`);
            if (result.success && result.data) {
                setLoans(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load loans for this index.',
                    variant: 'destructive',
                });
                setLoans([]);
            }
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to load loans for this index.',
                variant: 'destructive',
            });
            setLoans([]);
        } finally {
            setIsLoading(false);
        }
    };

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedLoans } = useTableSearch(loans);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="w-[95vw] max-w-[900px] max-h-[85vh] overflow-hidden p-0 gap-0">
                    <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-green-50 to-emerald-50 dark:from-brand-green-darker dark:to-sidebar-accent">
                        <DialogTitle className="text-xl font-bold text-foreground dark:text-white flex items-center gap-2">
                            <BookOpen className="h-5 w-5" />
                            Loan Passbooks — {indexNo}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="overflow-y-auto max-h-[calc(85vh-80px)] p-6">
                        {isLoading ? (
                            <PageLoader label="Loading loans..." fullScreen={false} />
                        ) : loans.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16">
                                <FileText className="h-10 w-10 text-muted-foreground mb-3" />
                                <p className="text-sm text-muted-foreground">No loans found in this index.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                            <div className="flex justify-end">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search loans..."
                                />
                            </div>
                            {searchedLoans.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16">
                                    <FileText className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-sm text-muted-foreground">No loans match your search.</p>
                                </div>
                            ) : (
                            <div className="overflow-x-auto rounded-lg border">
                                <Table>
                                    <TableHeader className="bg-brand-green-darker dark:bg-sidebar-accent text-white">
                                        <TableRow className="hover:bg-brand-green-darker dark:hover:bg-sidebar-accent border-none">
                                            <TableHead className="text-white">Loan Number</TableHead>
                                            <TableHead className="text-white">Client</TableHead>
                                            <TableHead className="text-white">Freq.</TableHead>
                                            <TableHead className="text-white text-right">Amount</TableHead>
                                            <TableHead className="text-white text-center">Passbook</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedLoans.map((loan) => (
                                            <TableRow key={loan.id} className="even:bg-green-50 dark:even:bg-brand-green-darker/50">
                                                <TableCell className="font-mono font-medium">{loan.loanNumber}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="font-bold text-foreground dark:text-slate-100">{loan.clientId}</span>
                                                        <span className="text-xs text-slate-500">{loan.clientName}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="uppercase text-xs">{loan.frequency}</TableCell>
                                                <TableCell className="text-right font-bold text-primary dark:text-primary">
                                                    ₹{formatCurrency(loan.amount)}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 px-2 border-primary text-primary hover:bg-green-50"
                                                        onClick={() => setPreviewLoan(loan)}
                                                    >
                                                        <BookOpen className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            )}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {previewLoan && (
                <LoanPassbookDialog
                    open={!!previewLoan}
                    onOpenChange={(o) => { if (!o) setPreviewLoan(null); }}
                    loanId={previewLoan.id}
                    loanNumber={previewLoan.loanNumber}
                    clientName={previewLoan.clientName}
                />
            )}
        </>
    );
}
