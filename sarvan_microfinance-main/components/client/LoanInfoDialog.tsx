'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { CalendarDays, CreditCard, IndianRupee, ListChecks } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

export interface LoanInfo {
    id: string;
    disbursementDate: string;
    loanAccount: string;
    loanAmount: number;
    totalDues: number;
    completedDues: number;
    collectedDues: number;
    dueStartDate: string;
    maturityDate: string;
    closedDate?: string;
    principalBalance: number;
    interestBalance: number;
    closingArrPrincipal: number;
    closingArrInterest: number;
}

interface LoanInfoDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    clientName: string | null;
    centerName: string | null;
    loans: LoanInfo[];
    isLoading?: boolean;
}

export function LoanInfoDialog({
    isOpen,
    onOpenChange,
    clientName,
    centerName,
    loans,
    isLoading = false,
}: LoanInfoDialogProps) {
    if (!clientName) {
        return null;
    }

    if (isLoading) {
        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="w-full max-w-full md:max-w-[58rem] border-none bg-green-950/95 p-0 text-white shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="sr-only">Loading Loan Information</DialogTitle>
                    </DialogHeader>
                    <PageLoader label="Loading loan information..." fullScreen={false} />
                </DialogContent>
            </Dialog>
        );
    }

    if (loans.length === 0) {
        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="w-full max-w-full md:max-w-[58rem] border-none bg-green-950/95 p-0 text-white shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="sr-only">Loan Information</DialogTitle>
                    </DialogHeader>
                    <div className="flex h-[500px] items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <CreditCard className="h-12 w-12 text-sidebar-accent" />
                            <p className="text-sm font-medium text-slate-300">No active loans found</p>
                            <p className="text-xs text-slate-500">
                                This client has no approved and active loans
                            </p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    const activeLoan = loans[0];

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="w-full max-w-full md:max-w-[58rem] border-none bg-green-950/95 p-0 text-white shadow-2xl">
                <DialogHeader className="sr-only">
                    <DialogTitle>Loan Information - {clientName}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-0 md:grid-cols-[1.15fr_1.85fr]">
                    {/* Left: Loan Summary */}
                    <div className="relative flex flex-col gap-6 border-r border-sidebar-accent bg-gradient-to-b from-brand-green-darker/80 via-green-950 to-green-950 p-7">
                        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.4),_transparent_55%)]" />

                        <div className="flex items-center gap-2 text-lg font-semibold text-slate-50">
                            <CreditCard className="h-4 w-4 text-primary" />
                            Loan Summary
                        </div>

                        <div className="space-y-2">
                            <p className="text-sm font-semibold text-slate-50">{clientName}</p>
                            {centerName && (
                                <p className="text-xs text-slate-400">Center: {centerName}</p>
                            )}
                        </div>

                        <div className="space-y-4 text-xs text-slate-300">
                            <div className="space-y-1">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                    Amount
                                </p>
                                <p className="flex items-center gap-1 text-base font-semibold text-emerald-300">
                                    <IndianRupee className="h-4 w-4" />
                                    {activeLoan.loanAmount.toLocaleString('en-IN')}
                                </p>
                                <p className="text-[12px] text-slate-300">
                                    Loan A/c:{' '}
                                    <span className="font-medium text-slate-100">
                                        {activeLoan.loanAccount}
                                    </span>
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                        Tenure
                                    </p>
                                    <p>
                                        Total Dues:{' '}
                                        <span className="font-semibold">{activeLoan.totalDues}</span>
                                    </p>
                                    <p>
                                        Completed:{' '}
                                        <span className="font-semibold">
                                            {activeLoan.completedDues}
                                        </span>{' '}
                                        / {activeLoan.totalDues}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                        Balances
                                    </p>
                                    <p>
                                        Pri. Balance:{' '}
                                        {activeLoan.principalBalance.toLocaleString('en-IN')}
                                    </p>
                                    <p>
                                        Int. Balance:{' '}
                                        {activeLoan.interestBalance.toLocaleString('en-IN')}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                        Key Dates
                                    </p>
                                    <p className="flex items-center gap-1 text-[12px]">
                                        <CalendarDays className="h-3 w-3" />
                                        Disb: {activeLoan.disbursementDate}
                                    </p>
                                    <p className="flex items-center gap-1 text-[12px]">
                                        <CalendarDays className="h-3 w-3" />
                                        Due Start: {activeLoan.dueStartDate}
                                    </p>
                                    <p className="flex items-center gap-1 text-[12px]">
                                        <CalendarDays className="h-3 w-3" />
                                        Maturity: {activeLoan.maturityDate}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-auto flex flex-wrap gap-2 pt-1">
                            <Badge
                                className={cn(
                                    'border-none bg-emerald-500/10 text-emerald-300',
                                    'px-2 py-0.5 text-[11px] font-semibold'
                                )}
                            >
                                Active Loan
                            </Badge>
                            <Badge className="border-none bg-sidebar-accent/60 px-2 py-0.5 text-[11px] text-slate-200">
                                Dues Left: {activeLoan.totalDues - activeLoan.completedDues}
                            </Badge>
                        </div>
                    </div>

                    {/* Right: Loan Schedule List */}
                    <div className="flex flex-col bg-green-950/95">
                        <div className="border-b border-sidebar-accent px-7 py-4 text-xs font-medium uppercase tracking-wide text-slate-400">
                            Loans
                        </div>

                        <ScrollArea className="max-h-[420px] px-7 py-4">
                            <div className="space-y-5 text-[12px] text-slate-200">
                                {loans.map((loan) => (
                                    <div
                                        key={loan.id}
                                        className="grid min-w-0 gap-4 rounded-2xl border border-sidebar-accent/80 bg-brand-green-darker/80 p-4 md:grid-cols-2"
                                    >
                                        <div className="space-y-2">
                                            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                                <ListChecks className="h-3 w-3" />
                                                {loan.loanAccount}
                                            </p>
                                            <p className="flex items-center gap-1 text-sm font-semibold text-emerald-300">
                                                <IndianRupee className="h-3 w-3" />
                                                {loan.loanAmount.toLocaleString('en-IN')}
                                            </p>
                                            <p className="text-[11px] text-slate-300">
                                                Dues:{' '}
                                                <span className="font-semibold">
                                                    {loan.completedDues}/{loan.totalDues}
                                                </span>{' '}
                                                &middot; Collected {loan.collectedDues}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 text-[11px] text-slate-300">
                                            <div className="space-y-1">
                                                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                                    Dates
                                                </p>
                                                <p className="break-words">Disb: {loan.disbursementDate}</p>
                                                <p className="break-words">Due Start: {loan.dueStartDate}</p>
                                                <p className="break-words">Mat.: {loan.maturityDate}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                                    Balances
                                                </p>
                                                <p>
                                                    Pri. Bal:{' '}
                                                    {loan.principalBalance.toLocaleString('en-IN')}
                                                </p>
                                                <p>
                                                    Int. Bal:{' '}
                                                    {loan.interestBalance.toLocaleString('en-IN')}
                                                </p>
                                                <p>
                                                    Closing Arr:{' '}
                                                    {loan.closingArrPrincipal.toLocaleString('en-IN')} /{' '}
                                                    {loan.closingArrInterest.toLocaleString('en-IN')}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}


