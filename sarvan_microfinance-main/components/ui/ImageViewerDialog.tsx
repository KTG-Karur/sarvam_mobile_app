'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StorageImage } from '@/components/storage/StorageMedia';
import { User, Clock } from 'lucide-react';
import { toDisplayDateTime } from '@/app/lib/date-format';

export type ImageViewerTarget = {
    src: string | null;
    alt: string;
    title?: string;
    uploadedByName?: string | null;
    uploadedAt?: string | null;
};

type ImageViewerDialogProps = {
    target: ImageViewerTarget | null;
    onClose: () => void;
};

export function ImageViewerDialog({ target, onClose }: ImageViewerDialogProps) {
    return (
        <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{target?.title ?? target?.alt}</DialogTitle>
                </DialogHeader>
                {target && (
                    <div className="space-y-3">
                        <div className="rounded-lg overflow-hidden border bg-muted/30 flex items-center justify-center">
                            <StorageImage src={target.src} alt={target.alt} className="max-h-[70vh] w-full object-contain" />
                        </div>
                        {(target.uploadedByName || target.uploadedAt) && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground border-t pt-3">
                                {target.uploadedByName && (
                                    <span className="flex items-center gap-1.5">
                                        <User className="h-3.5 w-3.5" /> Uploaded by{' '}
                                        <span className="font-medium text-foreground">{target.uploadedByName}</span>
                                    </span>
                                )}
                                {target.uploadedAt && (
                                    <span className="flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5" />
                                        {toDisplayDateTime(new Date(target.uploadedAt))}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
