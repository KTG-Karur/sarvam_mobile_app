'use client';

import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, FileText, Loader2, AlertCircle } from 'lucide-react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { cn } from '@/lib/utils';

export interface DocumentPreviewTarget {
    title: string;
    fileUrl: string;
    fileName: string;
    mimeType?: string | null;
}

interface DocumentPreviewModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    document: DocumentPreviewTarget | null;
    onDownload?: () => void;
}

function isImageFile(fileName: string, mimeType?: string | null): boolean {
    if (mimeType?.startsWith('image/')) return true;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext);
}

function isPdfFile(fileName: string, mimeType?: string | null): boolean {
    if (mimeType === 'application/pdf') return true;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return ext === 'pdf';
}

export function DocumentPreviewModal({
    open,
    onOpenChange,
    document,
    onDownload,
}: DocumentPreviewModalProps) {
    const rawUrl = document?.fileUrl ?? null;
    const resolvedUrl = useSignedUrl(rawUrl);

    if (!document) return null;

    const isImage = isImageFile(document.fileName, document.mimeType);
    const isPdf = isPdfFile(document.fileName, document.mimeType);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl w-[94vw] max-h-[92vh] flex flex-col p-4 sm:p-6 overflow-hidden bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent">
                <DialogHeader className="flex flex-row items-center justify-between pr-8 border-b pb-3 border-primary/10 dark:border-sidebar-accent/30">
                    <div className="space-y-0.5 truncate">
                        <DialogTitle className="text-base sm:text-lg font-semibold truncate text-foreground dark:text-slate-100">
                            {document.title}
                        </DialogTitle>
                        <p className="text-xs text-muted-foreground truncate font-mono">
                            {document.fileName}
                        </p>
                    </div>
                    {onDownload && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onDownload}
                            className="gap-1.5 shrink-0 ml-4 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint/50 dark:border-sidebar-accent/50 dark:text-emerald-300"
                        >
                            <Download className="h-4 w-4" />
                            <span className="hidden sm:inline">Download</span>
                        </Button>
                    )}
                </DialogHeader>

                <div className="flex-1 overflow-auto flex items-center justify-center p-2 sm:p-4 min-h-[50vh] max-h-[76vh]">
                    {!resolvedUrl ? (
                        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-xs font-medium">Loading document...</p>
                        </div>
                    ) : isImage ? (
                        <div className="flex items-center justify-center h-full w-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={resolvedUrl}
                                alt={document.title}
                                className="max-h-[74vh] max-w-full w-auto object-contain rounded-lg border border-primary/20 shadow-md bg-white dark:bg-black/20"
                            />
                        </div>
                    ) : isPdf ? (
                        <iframe
                            src={resolvedUrl}
                            title={document.title}
                            className="w-full h-[74vh] rounded-lg border border-primary/20 bg-white dark:border-sidebar-accent shadow-inner"
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-primary/30">
                            <FileText className="h-16 w-16 text-muted-foreground/60 mb-3" />
                            <h3 className="text-sm font-semibold text-foreground dark:text-slate-200">
                                Preview Not Available
                            </h3>
                            <p className="text-xs text-muted-foreground mt-1 mb-4">
                                This file type ({document.fileName.split('.').pop()?.toUpperCase() || 'FILE'}) cannot be previewed directly in the browser. Please download the file to view its contents.
                            </p>
                            {onDownload && (
                                <Button onClick={onDownload} className="gap-2 bg-primary text-white">
                                    <Download className="h-4 w-4" /> Download File
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

