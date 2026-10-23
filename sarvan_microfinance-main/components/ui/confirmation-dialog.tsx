'use client';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2, Info, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type ConfirmationType = 'delete' | 'warning' | 'info' | 'success' | 'danger';

interface ConfirmationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    type?: ConfirmationType;
    isLoading?: boolean;
    /** Extra content rendered between the description and the buttons (e.g. a location picker). */
    children?: ReactNode;
    /** Disables the confirm button without showing the loading state. */
    confirmDisabled?: boolean;
    /** Overrides the default max-w-md content width. */
    contentClassName?: string;
}

const typeConfig: Record<
    ConfirmationType,
    {
        icon: typeof AlertTriangle;
        iconColor: string;
        confirmButtonClass: string;
        titleColor: string;
    }
> = {
    delete: {
        icon: Trash2,
        iconColor: 'text-red-500',
        confirmButtonClass: 'bg-red-600 hover:bg-red-700 text-white',
        titleColor: 'text-red-600 dark:text-red-400',
    },
    warning: {
        icon: AlertTriangle,
        iconColor: 'text-amber-500',
        confirmButtonClass: 'bg-amber-600 hover:bg-amber-700 text-white',
        titleColor: 'text-amber-600 dark:text-amber-400',
    },
    info: {
        icon: Info,
        iconColor: 'text-primary',
        confirmButtonClass: 'bg-primary hover:bg-primary text-white',
        titleColor: 'text-primary dark:text-primary',
    },
    success: {
        icon: CheckCircle2,
        iconColor: 'text-emerald-500',
        confirmButtonClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        titleColor: 'text-emerald-600 dark:text-emerald-400',
    },
    danger: {
        icon: XCircle,
        iconColor: 'text-red-500',
        confirmButtonClass: 'bg-red-600 hover:bg-red-700 text-white',
        titleColor: 'text-red-600 dark:text-red-400',
    },
};

export function ConfirmationDialog({
    open,
    onOpenChange,
    onConfirm,
    title,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'delete',
    isLoading = false,
    children,
    confirmDisabled = false,
    contentClassName,
}: ConfirmationDialogProps) {
    // Be defensive: if an unknown type is passed, fall back to a safe config
    const config = typeConfig[type] ?? typeConfig.info;
    const Icon = config.icon;

    const handleConfirm = () => {
        onConfirm();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'max-w-md border-primary/20 bg-white shadow-2xl dark:border-sidebar-accent dark:bg-brand-green-darker',
                    contentClassName
                )}
                showCloseButton={!isLoading}
            >
                <DialogHeader>
                    <div className="flex items-start gap-4">
                        {/* Icon */}
                        <div
                            className={cn(
                                'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 bg-green-50 dark:bg-sidebar-accent',
                                type === 'delete' || type === 'danger'
                                    ? 'border-red-200 dark:border-red-900/50'
                                    : type === 'warning'
                                      ? 'border-amber-200 dark:border-amber-900/50'
                                      : type === 'success'
                                        ? 'border-emerald-200 dark:border-emerald-900/50'
                                        : 'border-primary/30 dark:border-brand-green-darker/50'
                            )}
                        >
                            <Icon className={cn('h-6 w-6', config.iconColor)} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 space-y-2">
                            <DialogTitle
                                className={cn(
                                    'text-lg font-semibold leading-tight',
                                    config.titleColor
                                )}
                            >
                                {title}
                            </DialogTitle>
                            <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400 whitespace-pre-line">
                                {description}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {children}

                <DialogFooter className="gap-3 sm:gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                        className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:bg-sidebar-accent"
                    >
                        {cancelText}
                    </Button>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isLoading || confirmDisabled}
                        className={cn(
                            'h-10 px-5 text-sm font-semibold shadow-sm transition-all',
                            config.confirmButtonClass,
                            isLoading && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-2">
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Processing...
                            </span>
                        ) : (
                            confirmText
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

