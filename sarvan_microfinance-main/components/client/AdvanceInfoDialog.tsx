'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CalendarDays, IndianRupee, ListChecks } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

export interface AdvanceRow {
    id: string;
    meetingSerial: string;
    meetingDate: string;
    description: string;
    amount: number;
}

interface AdvanceInfoDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    clientName: string | null;
    centerName: string | null;
    rows: AdvanceRow[];
    isLoading?: boolean;
}

export function AdvanceInfoDialog({
    isOpen,
    onOpenChange,
    clientName,
    centerName,
    rows,
    isLoading = false,
}: AdvanceInfoDialogProps) {
    if (!clientName) {
        return null;
    }

    if (isLoading) {
        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="w-full max-w-full md:max-w-[54rem] border-none bg-green-950/95 p-0 text-white shadow-2xl">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Loading Advance Information</DialogTitle>
                    </DialogHeader>
                    <PageLoader label="Loading advance information..." fullScreen={false} />
                </DialogContent>
            </Dialog>
        );
    }

    if (rows.length === 0) {
        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="w-full max-w-full md:max-w-[54rem] border-none bg-green-950/95 p-0 text-white shadow-2xl">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Advance Information</DialogTitle>
                    </DialogHeader>
                    <div className="flex h-[500px] items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <ListChecks className="h-12 w-12 text-sidebar-accent" />
                            <p className="text-sm font-medium text-slate-300">No advance data found</p>
                            <p className="text-xs text-slate-500">
                                Advance summary information is not available for this client
                            </p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="w-full max-w-full md:max-w-[54rem] border-none bg-green-950/95 p-0 text-white shadow-2xl">
                <DialogHeader className="sr-only">
                    <DialogTitle>Advance Summary - {clientName}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-0 md:grid-cols-[1.35fr_1.9fr]">
                    {/* Left: Advance Summary */}
                    <div className="relative flex flex-col gap-6 border-r border-sidebar-accent bg-gradient-to-b from-brand-green-darker/80 via-green-950 to-green-950 p-7">
                        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.4),_transparent_55%)]" />

                        <div className="flex items-center gap-2 text-lg font-semibold text-slate-50">
                            <ListChecks className="h-4 w-4 text-primary" />
                            Advance Summary
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
                                    Total Amount
                                </p>
                                <p className="flex items-center gap-1 text-base font-semibold text-emerald-300">
                                    <IndianRupee className="h-4 w-4" />
                                    {totalAmount.toLocaleString('en-IN')}
                                </p>
                            </div>

                            <div className="space-y-1">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                    Meetings
                                </p>
                                <p>
                                    Rows:{' '}
                                    <span className="font-semibold">
                                        {rows.length}
                                    </span>
                                </p>
                                <p className="flex items-center gap-1 text-[12px]">
                                    <CalendarDays className="h-3 w-3" />
                                    Last Meeting:{' '}
                                    {rows[rows.length - 1]?.meetingDate || '-'}
                                </p>
                            </div>
                        </div>

                        <div className="mt-auto flex flex-wrap gap-2 pt-1">
                            <Badge
                                className={cn(
                                    'border-none bg-emerald-500/10 text-emerald-300',
                                    'px-2 py-0.5 text-[11px] font-semibold'
                                )}
                            >
                                Advance Overview
                            </Badge>
                        </div>
                    </div>

                    {/* Right: Advance Table */}
                    <div className="flex flex-col bg-green-950/95">
                        <div className="border-b border-sidebar-accent px-7 py-4 text-xs font-medium uppercase tracking-wide text-slate-400">
                            Advance Details
                        </div>

                        <ScrollArea className="max-h-[420px] px-7 py-4">
                            <div className="overflow-hidden rounded-2xl border border-sidebar-accent/80 bg-brand-green-darker/70 text-[12px] text-slate-200">
                                <div className="grid grid-cols-[1fr_1.4fr_2fr_1.2fr] bg-brand-green-darker/90 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                                    <div className="px-3 py-2 border-b border-sidebar-accent/80">Meeting Sno</div>
                                    <div className="px-3 py-2 border-b border-sidebar-accent/80">Meeting Date</div>
                                    <div className="px-3 py-2 border-b border-sidebar-accent/80">Description</div>
                                    <div className="px-3 py-2 border-b border-sidebar-accent/80 text-right">Amount</div>
                                </div>
                                <div>
                                    {rows.map((row) => (
                                        <div
                                            key={row.id}
                                            className="grid grid-cols-[1fr_1.4fr_2fr_1.2fr] border-t border-sidebar-accent/60 bg-green-950/30 first:border-t-0"
                                        >
                                            <div className="px-3 py-2">{row.meetingSerial}</div>
                                            <div className="px-3 py-2">{row.meetingDate}</div>
                                            <div className="px-3 py-2 break-words">{row.description}</div>
                                            <div className="px-3 py-2 text-right">
                                                {row.amount.toLocaleString('en-IN')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}


