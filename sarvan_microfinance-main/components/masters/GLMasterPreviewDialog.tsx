'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookOpen, Edit, FileText, Hash, Layers, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface GLMasterDetails {
    glId: string;
    glName: string;
    glType: 'PRINCIPLE' | 'INTEREST';
    description?: string;
}

interface GLMasterPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    gl: GLMasterDetails | null;
    onEdit?: (glId: string) => void;
}

export function GLMasterPreviewDialog({
    open,
    onOpenChange,
    gl,
    onEdit,
}: GLMasterPreviewDialogProps) {
    if (!gl) {
        return null;
    }

    const handleEdit = () => {
        if (onEdit) {
            onEdit(gl.glId);
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl p-0 overflow-hidden border-none bg-white dark:bg-brand-green-darker shadow-2xl">
                <div className="bg-gradient-to-r from-primary via-primary to-primary h-2 w-full" />

                <div className="p-8">
                    <DialogHeader className="pb-6">
                        <DialogTitle className="flex items-center gap-4 text-2xl font-bold text-foreground dark:text-white">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 dark:bg-brand-green-darker/30 text-primary shadow-inner">
                                <BookOpen className="h-6 w-6" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span>GL Account Details</span>
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "w-fit text-[10px] py-0 px-2 h-5 border-none",
                                        gl.glType === 'PRINCIPLE'
                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                    )}
                                >
                                    {gl.glType} CATEGORY
                                </Badge>
                            </div>
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6">
                        {/* Info Grid */}
                        <div className="grid gap-6 md:grid-cols-2">
                            {/* GL ID */}
                            <div className="space-y-2 group">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-primary transition-colors">
                                    <Hash className="h-3.5 w-3.5" />
                                    GL Account ID
                                </div>
                                <div className="rounded-xl border border-slate-100 bg-green-50/50 px-4 py-3 text-sm font-bold text-primary shadow-sm dark:border-sidebar-accent dark:bg-green-950/50 dark:text-primary">
                                    {gl.glId}
                                </div>
                            </div>

                            {/* GL Type */}
                            <div className="space-y-2 group">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-primary transition-colors">
                                    <Layers className="h-3.5 w-3.5" />
                                    Account Category
                                </div>
                                <div className="rounded-xl border border-slate-100 bg-green-50/50 px-4 py-3 text-sm font-bold text-sidebar-accent shadow-sm dark:border-sidebar-accent dark:bg-green-950/50 dark:text-slate-300">
                                    {gl.glType === 'PRINCIPLE' ? 'Principle Ledger' : 'Interest Ledger'}
                                </div>
                            </div>
                        </div>

                        {/* Account Name */}
                        <div className="space-y-2 group">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-primary transition-colors">
                                <FileText className="h-3.5 w-3.5" />
                                Full Account Name
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-green-50/50 px-5 py-4 text-base font-semibold text-foreground shadow-sm dark:border-sidebar-accent dark:bg-green-950/50 dark:text-slate-100 italic transition-all group-hover:not-italic">
                                {gl.glName}
                            </div>
                        </div>

                        {/* Description */}
                        <div className="space-y-2 group">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-primary transition-colors">
                                <Info className="h-3.5 w-3.5" />
                                Description & Purpose
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-green-50/50 px-5 py-4 text-sm leading-relaxed text-sidebar-accent shadow-sm dark:border-sidebar-accent dark:bg-green-950/50 dark:text-slate-400 min-h-[80px]">
                                {gl.description || 'No description provided for this GL account.'}
                            </div>
                        </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex items-center justify-between gap-4 pt-8 mt-4 border-t border-slate-100 dark:border-sidebar-accent">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            className="h-11 px-6 text-sm font-bold text-slate-500 hover:bg-green-50 dark:hover:bg-sidebar-accent"
                        >
                            Back to Registry
                        </Button>
                        <Button
                            type="button"
                            onClick={handleEdit}
                            className="h-11 px-8 text-sm font-bold bg-primary hover:bg-sidebar-accent text-white shadow-lg shadow-primary dark:shadow-none transition-all duration-200 active:scale-95"
                        >
                            <span className="flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                Edit Account
                            </span>
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
