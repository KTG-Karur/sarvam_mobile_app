'use client';

import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface HeaderStat {
    label: string;
    value: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    subtitle?: string;
    headerStats?: HeaderStat[];
    children: React.ReactNode;
}

export function DrillDownModal({ open, onOpenChange, title, subtitle, headerStats, children }: Props) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="flex w-screen h-screen max-h-screen flex-col gap-0 rounded-none p-0 sm:h-[90vh] sm:max-h-[90vh] sm:w-[95vw] sm:max-w-[1800px] sm:rounded-lg lg:w-[92vw]"
            >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-primary/20 bg-gradient-to-r from-primary via-brand-green-light to-sidebar-accent px-6 py-4 dark:border-sidebar-accent">
                    <div>
                        <DialogTitle className="text-lg font-bold text-white">{title}</DialogTitle>
                        {subtitle && <p className="text-sm text-green-100">{subtitle}</p>}
                        <DialogDescription className="sr-only">{subtitle ?? title}</DialogDescription>
                    </div>
                    <div className="flex items-center gap-4">
                        {headerStats && headerStats.length > 0 && (
                            <div className="flex flex-wrap gap-3">
                                {headerStats.map((s) => (
                                    <div key={s.label} className="rounded-lg bg-white/15 px-3 py-1.5 text-right">
                                        <div className="text-[11px] text-green-100">{s.label}</div>
                                        <div className="text-sm font-semibold text-white">{s.value}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="rounded-lg p-1.5 text-white/90 transition hover:bg-white/20 hover:text-white"
                        >
                            <X className="h-5 w-5" />
                            <span className="sr-only">Close</span>
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-hidden">{children}</div>
            </DialogContent>
        </Dialog>
    );
}
