'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
    Loader2, Send, RotateCcw, CheckCircle2, XCircle, User,
} from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { Switch } from '@/components/ui/switch';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

function getTodayStr(): string {
    return new Date().toISOString().split('T')[0];
}

type LoanApplication = {
    id: string;
    clientId: string;
    clientName: string;
    purpose: string;
    product: string;
    loanProductTypeName: string;
    amount: number;
    frequency: string;
    tenureMonths: number;
    interestRate: number;
    isSelected: boolean;
    isRejected: boolean;
    disbursementStatus: string;
};

type IndexDetailsData = {
    indexNo: string;
    indexDate: string;
    centerCode: string;
    centerName: string;
    frequency: string;
    totalApps: number;
    totalAmount: number;
    loanApplications: LoanApplication[];
};

interface LoanIndexDetailsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    indexId: string;
    indexNo: string;
    indexDate: string;
    centerCode: string;
    centerName: string;
    centerId: string;
    frequency: string;
    onSuccess?: () => void;
}

export function LoanIndexDetailsDialog({
    open,
    onOpenChange,
    indexId,
    indexNo,
    indexDate,
    centerCode,
    centerName,
    centerId,
    frequency,
    onSuccess,
}: LoanIndexDetailsDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [indexData, setIndexData] = useState<IndexDetailsData | null>(null);
    const [loanApplications, setLoanApplications] = useState<LoanApplication[]>([]);
    const [firstDueDate, setFirstDueDate] = useState<string>('');

    const { toast } = useToast();
    // Validate the first due date against the branch's EOD working date (session
    // branch), not the browser wall-clock date — the branch may be on a working
    // day that lags real time.
    const { eodWorkingDate } = useEodWorkingDate();
    const minDueDate = eodWorkingDate || getTodayStr();

    useEffect(() => {
        if (open && indexId) {
            fetchIndexDetails();
        }
    }, [open, indexId]);

    const fetchIndexDetails = async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<any[]>(`/loan-indexes/${indexId}/loans`);

            if (result.success && result.data) {
                const existingFirstDue = result.data.find((l: any) => l.firstDueDate)?.firstDueDate;
                setFirstDueDate(existingFirstDue || getTodayStr());

                const applications: LoanApplication[] = result.data.map((loan: any) => ({
                    id: loan.id,
                    clientId: loan.clientId,
                    clientName: loan.clientName,
                    purpose: loan.purpose,
                    product: loan.product,
                    loanProductTypeName: loan.loanProductTypeName || '',
                    amount: loan.amount,
                    frequency: loan.frequency,
                    tenureMonths: loan.tenureMonths,
                    interestRate: loan.interestRate,
                    isSelected: ['PENDING_LEVEL1', 'PENDING_LEVEL2', 'APPROVED_LEVEL1'].includes(loan.disbursementStatus),
                    isRejected: loan.disbursementStatus === 'REJECTED',
                    disbursementStatus: loan.disbursementStatus,
                }));

                setLoanApplications(applications);

                const totalAmount = applications.reduce((sum, app) => sum + app.amount, 0);
                setIndexData({
                    indexNo,
                    indexDate: toDisplayDate(new Date(indexDate)),
                    centerCode,
                    centerName,
                    frequency,
                    totalApps: applications.length,
                    totalAmount,
                    loanApplications: applications,
                });
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load loan index details.', variant: 'destructive' });
                setLoanApplications([]);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load loan index details. Please try again.', variant: 'destructive' });
            setLoanApplications([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectToggle = (loanId: string) => {
        setLoanApplications(prev =>
            prev.map(loan => loan.id === loanId ? { ...loan, isSelected: !loan.isSelected, isRejected: false } : loan)
        );
    };

    const handleRejectToggle = (loanId: string) => {
        setLoanApplications(prev =>
            prev.map(loan => loan.id === loanId ? { ...loan, isRejected: !loan.isRejected, isSelected: false } : loan)
        );
    };

    const handleSelectAll = (checked: boolean) => {
        setLoanApplications(prev =>
            prev.map(loan => ({ ...loan, isSelected: checked, isRejected: checked ? false : loan.isRejected }))
        );
    };

    const handleRejectAll = (checked: boolean) => {
        setLoanApplications(prev =>
            prev.map(loan => ({ ...loan, isRejected: checked, isSelected: checked ? false : loan.isSelected }))
        );
    };

    const handleSave = async () => {
        const selectedLoans = loanApplications.filter(l => l.isSelected);
        const rejectedLoans = loanApplications.filter(l => l.isRejected);

        if (selectedLoans.length > 0) {
            if (!firstDueDate || firstDueDate < minDueDate) {
                toast({
                    title: 'First Due Date Required',
                    description: `Please set a valid First Due Date (on or after the branch working date ${minDueDate}) before submitting.`,
                    variant: 'destructive',
                });
                return;
            }
        }

        setIsSaving(true);
        try {
            const result = await apiClient.post<any>(`/loan-indexes/${indexId}/approve`, {
                selectedLoanIds: selectedLoans.map(l => l.id),
                rejectedLoanIds: rejectedLoans.map(l => l.id),
                firstDueDate: firstDueDate,
            });

            if (!result.success) {
                toast({
                    title: 'Submission Failed',
                    description: result.error || 'Failed to submit loans for AM approval.',
                    variant: 'destructive',
                });
                return;
            }

            toast({
                title: 'Submitted for AM Approval',
                description: `${selectedLoans.length} loan(s) submitted for Area Manager review.${rejectedLoans.length > 0 ? ` ${rejectedLoans.length} loan(s) rejected.` : ''}`,
            });
            onOpenChange(false);
            onSuccess?.();
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save selections. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setLoanApplications(loanApplications.map(l => ({ ...l, isSelected: false, isRejected: false })));
        toast({ title: 'Reset', description: 'All selections have been cleared.' });
    };

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

    const selectedCount = loanApplications.filter(l => l.isSelected).length;
    const rejectedCount = loanApplications.filter(l => l.isRejected).length;
    const selectedAmount = loanApplications.filter(l => l.isSelected).reduce((s, l) => s + l.amount, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!max-w-none w-[85vw] max-w-[1400px] max-h-[90vh] overflow-hidden p-0">
                {/* Header */}
                <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-primary to-primary">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-xl font-bold text-white">
                                Loan Index Details — #{indexNo}
                            </DialogTitle>
                            {indexData && (
                                <p className="text-sm text-green-100 mt-1">
                                    {indexData.centerCode} - {indexData.centerName} | Date: {indexData.indexDate}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col items-end gap-1">
                                <p className="text-[10px] text-green-100 uppercase font-semibold">Bulk Approve</p>
                                <Switch
                                    checked={loanApplications.length > 0 && loanApplications.every(l => l.isSelected)}
                                    onCheckedChange={handleSelectAll}
                                    className="data-[state=checked]:bg-green-400 scale-90"
                                />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <p className="text-[10px] text-green-100 uppercase font-semibold">Bulk Reject</p>
                                <Switch
                                    checked={loanApplications.length > 0 && loanApplications.every(l => l.isRejected)}
                                    onCheckedChange={handleRejectAll}
                                    className="data-[state=checked]:bg-red-400 scale-90"
                                />
                            </div>
                            <div className="h-10 w-px bg-primary/50" />
                            <div className="text-right">
                                <p className="text-xs text-green-100">Selected</p>
                                <p className="text-xl font-bold text-white">{selectedCount} / {loanApplications.length}</p>
                            </div>
                            <div className="h-10 w-px bg-primary/50" />
                            <div className="text-right">
                                <p className="text-xs text-green-100">Total Amount</p>
                                <p className="text-xl font-bold text-white">₹{formatCurrency(selectedAmount)}</p>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                {/* Content */}
                <div className="overflow-y-auto max-h-[calc(90vh-180px)] p-6">
                    {isLoading ? (
                        <PageLoader label="Loading loan applications..." fullScreen={false} />
                    ) : loanApplications.length > 0 ? (
                        <div className="space-y-3">
                            {loanApplications.map((loan, index) => (
                                <div
                                    key={loan.id}
                                    className={`group relative rounded-xl border-2 transition-all duration-200 ${loan.isSelected
                                        ? 'border-green-500 bg-green-50 dark:bg-green-950/20 shadow-md'
                                        : loan.isRejected
                                            ? 'border-red-500 bg-red-50 dark:bg-red-950/20 shadow-md'
                                            : 'border-primary/20 bg-white dark:border-sidebar-accent dark:bg-brand-green-darker hover:border-primary/50 hover:shadow-lg'
                                        }`}
                                >
                                    {(loan.isSelected || loan.isRejected) && (
                                        <div className="absolute -top-2 -right-2 z-10">
                                            {loan.isSelected ? (
                                                <Badge className="bg-green-600 text-white shadow-lg">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />Approved
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-red-600 text-white shadow-lg">
                                                    <XCircle className="h-3 w-3 mr-1" />Rejected
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                    <div className="p-5">
                                        <div className="grid grid-cols-12 gap-4 items-center">
                                            <div className="col-span-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary text-white font-bold shadow-md">
                                                        {index + 1}
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-slate-500">Client ID</p>
                                                        <p className="font-semibold text-foreground dark:text-white">{loan.clientId}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-xs text-slate-500 mb-1">Client Name</p>
                                                <div className="flex items-center gap-2">
                                                    <User className="h-4 w-4 text-slate-400" />
                                                    <p className="font-medium text-foreground dark:text-white">{loan.clientName}</p>
                                                </div>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-xs text-slate-500 mb-1">Purpose</p>
                                                <Badge variant="outline" className="font-normal">{loan.purpose}</Badge>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-xs text-slate-500 mb-1">Product Name</p>
                                                <p className="font-medium text-foreground dark:text-white">{loan.product}</p>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-xs text-slate-500 mb-1">Amount</p>
                                                <p className="text-lg font-bold text-sidebar-accent dark:text-primary">
                                                    ₹{formatCurrency(loan.amount)}
                                                </p>
                                            </div>
                                            <div className="col-span-1">
                                                <div className="flex flex-col gap-3 items-center">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-[9px] uppercase font-bold text-green-600">Approve</span>
                                                        <Switch
                                                            checked={loan.isSelected}
                                                            onCheckedChange={() => handleSelectToggle(loan.id)}
                                                            className="data-[state=checked]:bg-green-600 scale-90"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-[9px] uppercase font-bold text-red-600">Reject</span>
                                                        <Switch
                                                            checked={loan.isRejected}
                                                            onCheckedChange={() => handleRejectToggle(loan.id)}
                                                            className="data-[state=checked]:bg-red-600 scale-90"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="rounded-full bg-brand-green-tint dark:bg-sidebar-accent p-6 mb-4">
                                <User className="h-12 w-12 text-slate-400" />
                            </div>
                            <p className="text-sm text-muted-foreground">No loan applications found for this index.</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t bg-green-50 dark:bg-brand-green-darker px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div>
                                <p className="text-xs text-slate-500">Approved</p>
                                <p className="text-lg font-bold text-green-700">{selectedCount}</p>
                            </div>
                            <div className="h-8 w-px bg-green-200 dark:bg-sidebar-accent" />
                            <div>
                                <p className="text-xs text-slate-500">Rejected</p>
                                <p className="text-lg font-bold text-red-700">{rejectedCount}</p>
                            </div>
                            <div className="h-8 w-px bg-green-200 dark:bg-sidebar-accent" />
                            <div>
                                <p className="text-xs text-slate-500">Total Amount</p>
                                <p className="text-lg font-bold text-sidebar-accent">₹{formatCurrency(selectedAmount)}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="dialogFirstDueDate" className="text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                                    First Due Date:
                                </Label>
                                <DateInput
                                    id="dialogFirstDueDate"
                                    value={firstDueDate}
                                    min={minDueDate}
                                    onChange={(e) => setFirstDueDate(e.target.value)}
                                    className="h-9 w-40 bg-white dark:bg-slate-900 border-slate-300 text-xs"
                                />
                            </div>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                size="lg"
                                disabled={isSaving}
                                className="gap-2"
                            >
                                <RotateCcw className="h-4 w-4" />Reset
                            </Button>
                            <Button
                                onClick={handleSave}
                                size="lg"
                                disabled={isSaving || (selectedCount === 0 && rejectedCount === 0)}
                                className="gap-2 bg-primary hover:bg-primary min-w-[240px]"
                            >
                                {isSaving ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" />Processing...</>
                                ) : (
                                    <><Send className="h-4 w-4" />Submit for AM Approval</>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
