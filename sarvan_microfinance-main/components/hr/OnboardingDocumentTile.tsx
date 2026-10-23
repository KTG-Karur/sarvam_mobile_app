'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Upload, Camera, Clipboard, Trash2, CheckCircle2, Loader2, FileText, Image as ImagePlaceholderIcon, Download, Eye } from 'lucide-react';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { useToast } from '@/hooks/use-toast';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { compressImageForCategory, type ImageCategory } from '@/app/lib/image-compress';

/**
 * One tile = one document slot (mirrors the visual language of
 * components/enrollment/DocumentInputWithUpload.tsx, used for KYC docs on
 * the client enrollment page — same preview box / badges / icon-button row,
 * but built fresh rather than reusing that component's useFileUpload/
 * useImageCompression hooks, which are hardwired to the KYC upload contract
 * (clientIdentifier, isEnrollment, category/owner extra fields) that doesn't
 * match onboarding documents (category+subtype posted to a different route).
 *
 * Image compression IS shared with that reference though — same
 * compressImageForCategory() engine from app/lib/image-compress.ts, just
 * called directly instead of through its KYC-flavored useImageCompression
 * hook (which expects a KYC document-type key, not a bare category). Runs
 * before onUpload in both the authenticated internal uploader and the
 * public joinee page, so a large phone-camera photo doesn't get stored at
 * full size in either flow. No-ops for PDFs and any non-image file.
 */

function fileExtensionLabel(fileName: string): string {
    const ext = fileName.split('.').pop();
    return ext && ext !== fileName ? ext.toUpperCase().slice(0, 4) : 'FILE';
}

interface ExistingDoc {
    id: string;
    fileName: string;
    status?: string;
    fileUrl?: string;
    mimeType?: string;
}

interface Props {
    label: string;
    accept?: string;
    /** Cosmetic red-asterisk hint only — not a hard upload/submission gate. */
    required?: boolean;
    existingDoc?: ExistingDoc | null;
    onUpload: (file: File) => Promise<void>;
    onDelete?: () => Promise<void>;
    /** Internal-only affordance — omitted on the public page (no signed-url access there). */
    onDownload?: () => void;
    /** Internal-only affordance — opens in-app preview modal (omitted on public page). */
    onPreview?: () => void;
    readOnly?: boolean;
    /** Compression preset — 'portrait' for the Photo tile, 'document' (default)
     * for everything else (Aadhaar/PAN/Bank Passbook/etc. — text must stay
     * readable, so a larger max dimension + higher quality than portraits). */
    imageCategory?: ImageCategory;
}

function statusBadgeColor(status?: string): string {
    if (status === 'VERIFIED') return 'bg-emerald-500';
    if (status === 'REJECTED') return 'bg-red-500';
    return 'bg-amber-500';
}

export function OnboardingDocumentTile({ label, accept = 'application/pdf,image/jpeg,image/png,image/webp', required, existingDoc, onUpload, onDelete, onDownload, onPreview, readOnly, imageCategory = 'document' }: Props) {
    const { toast } = useToast();
    const reactId = useId();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [localPreview, setLocalPreview] = useState<{ url: string; isPdf: boolean } | null>(null);

    // Revoke blob URL when replaced or when the tile unmounts
    useEffect(() => () => {
        if (localPreview?.url) URL.revokeObjectURL(localPreview.url);
    }, [localPreview]);

    // For existing documents, resolve signed URL for viewing/thumbnail
    const existingSignedUrl = useSignedUrl(existingDoc?.fileUrl ?? null);

    const isPdf = localPreview
        ? localPreview.isPdf
        : existingDoc?.mimeType === 'application/pdf' || /\.pdf$/i.test(existingDoc?.fileName || '');

    const isImage = localPreview
        ? !localPreview.isPdf
        : existingDoc?.mimeType?.startsWith('image/') || /\.(jpe?g|png|webp|gif|svg|bmp)$/i.test(existingDoc?.fileName || '');

    const displayUrl = localPreview?.url || existingSignedUrl;

    const isImageAccept = accept.includes('image/');
    const canPickFile = !readOnly && !uploading;

    const doUpload = useCallback(async (rawFile: File) => {
        setUploading(true);
        if (localPreview?.url) URL.revokeObjectURL(localPreview.url);

        // Compress before storing — a phone camera shot can be several MB;
        // no-ops for PDFs and any non-image file. Preview is built from the
        // compressed result so it matches what's actually uploaded.
        let file = rawFile;
        if (rawFile.type.startsWith('image/')) {
            try {
                const result = await compressImageForCategory(rawFile, imageCategory);
                file = result.compressedFile;
            } catch {
                // Fall back to the original file — never block an upload on
                // compression failing.
            }
        }

        if (file.type.startsWith('image/')) {
            setLocalPreview({ url: URL.createObjectURL(file), isPdf: false });
        } else if (file.type === 'application/pdf') {
            setLocalPreview({ url: URL.createObjectURL(file), isPdf: true });
        } else {
            setLocalPreview(null);
        }
        try {
            await onUpload(file);
        } finally {
            setUploading(false);
        }
    }, [onUpload, localPreview, imageCategory]);

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void doUpload(file);
    };

    // Mirrors components/enrollment/DocumentInputWithUpload.tsx's clipboard-paste.
    const handlePasteFromClipboard = useCallback(async () => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((t) => t.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], `pasted_${Date.now()}.png`, { type: imageType });
                    void doUpload(file);
                    return;
                }
            }
            toast({
                title: 'No image found',
                description: 'Clipboard does not contain an image. Copy an image first.',
                variant: 'destructive',
            });
        } catch {
            toast({
                title: 'Paste failed',
                description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.',
                variant: 'destructive',
            });
        }
    }, [doUpload, toast]);

    const hasDoc = !!existingDoc;

    return (
        <div className={cn('flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-brand-green-darker/10 border-primary/20 dark:border-sidebar-accent/30')}>
            <div
                className={cn(
                    'relative flex aspect-[4/3] items-center justify-center bg-brand-green-tint/50 dark:bg-brand-green-darker/30 overflow-hidden',
                    hasDoc && onPreview && 'cursor-pointer',
                )}
            >
                {displayUrl && isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayUrl} alt={label} className="h-full w-full object-cover" />
                ) : displayUrl && isPdf ? (
                    <div className="relative h-full w-full overflow-hidden bg-slate-50 dark:bg-slate-900/40">
                        <iframe
                            src={`${displayUrl}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
                            title={label}
                            className="h-full w-full pointer-events-none border-0 select-none scale-100 origin-top"
                            tabIndex={-1}
                        />
                        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-red-600/90 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white shadow z-10">
                            PDF
                        </span>
                    </div>
                ) : hasDoc ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 text-sidebar-accent dark:text-emerald-300">
                        <FileText className="h-10 w-10" />
                        <span className="text-[10px] font-semibold tracking-wide">{fileExtensionLabel(existingDoc.fileName)}</span>
                    </div>
                ) : (
                    <ImagePlaceholderIcon className="h-12 w-12 text-primary/30 dark:text-emerald-400/30" />
                )}

                {/* Click overlay to preview document when preview is enabled */}
                {hasDoc && onPreview && !uploading && (
                    <div
                        className="absolute inset-0 cursor-pointer"
                        onClick={onPreview}
                        title={`Preview ${label}`}
                    />
                )}

                {hasDoc && !uploading && (
                    <div className={cn('absolute left-1.5 top-1.5 z-10 rounded-full p-0.5 text-white shadow', statusBadgeColor(existingDoc.status))}>
                        <CheckCircle2 className="h-3 w-3" />
                    </div>
                )}

                {hasDoc && !readOnly && !uploading && onDelete && (
                    <button
                        type="button"
                        title="Remove"
                        aria-label={`Remove ${label}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white shadow-lg ring-2 ring-white hover:bg-red-700 dark:ring-brand-green-darker"
                    >
                        <Trash2 className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                )}

                {hasDoc && onPreview && (
                    <button
                        type="button"
                        title="Preview"
                        aria-label={`Preview ${label}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPreview();
                        }}
                        className={cn(
                            'absolute bottom-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-sidebar-accent shadow ring-1 ring-primary/20 hover:bg-white dark:bg-slate-900/95 dark:text-emerald-300',
                            onDownload ? 'right-11' : 'right-2',
                        )}
                    >
                        <Eye className="h-4 w-4" />
                    </button>
                )}

                {hasDoc && onDownload && (
                    <button
                        type="button"
                        title="Download"
                        aria-label={`Download ${label}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDownload();
                        }}
                        className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-sidebar-accent shadow ring-1 ring-primary/20 hover:bg-white dark:bg-slate-900/95 dark:text-emerald-300"
                    >
                        <Download className="h-4 w-4" />
                    </button>
                )}

                {uploading && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-black/50 text-white">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-[10px]">Uploading…</span>
                    </div>
                )}
            </div>

            <div className="flex flex-1 flex-col gap-2 p-3">
                <Label htmlFor={`${reactId}-file`} className="text-xs font-semibold leading-snug text-foreground dark:text-slate-200">
                    {label} {required && <span className="text-red-500">*</span>}
                </Label>

                {!readOnly && (
                    <div className="mt-auto flex items-center gap-2 pt-1">
                        <button
                            type="button"
                            title={hasDoc ? `Replace ${label}` : `Upload ${label}`}
                            aria-label={hasDoc ? `Replace ${label}` : `Upload ${label}`}
                            onClick={() => canPickFile && fileInputRef.current?.click()}
                            disabled={!canPickFile}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-brand-green-tint/60 text-sidebar-accent transition-colors hover:bg-brand-green-tint disabled:opacity-50 dark:border-sidebar-accent/40 dark:bg-brand-green-darker/30 dark:text-emerald-300"
                        >
                            <Upload className="h-4 w-4" />
                        </button>
                        {isImageAccept && (
                            <button
                                type="button"
                                title={hasDoc ? `Replace ${label} — Camera` : `Take photo for ${label}`}
                                aria-label={`Camera for ${label}`}
                                onClick={() => canPickFile && setCameraOpen(true)}
                                disabled={!canPickFile}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-brand-green-tint/60 text-sidebar-accent transition-colors hover:bg-brand-green-tint disabled:opacity-50 dark:border-sidebar-accent/40 dark:bg-brand-green-darker/30 dark:text-emerald-300"
                            >
                                <Camera className="h-4 w-4" />
                            </button>
                        )}
                        {isImageAccept && (
                            <button
                                type="button"
                                title={hasDoc ? `Replace ${label} — Paste` : `Paste image for ${label}`}
                                aria-label={`Paste image for ${label}`}
                                onClick={() => canPickFile && handlePasteFromClipboard()}
                                disabled={!canPickFile}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-brand-green-tint/60 text-sidebar-accent transition-colors hover:bg-brand-green-tint disabled:opacity-50 dark:border-sidebar-accent/40 dark:bg-brand-green-darker/30 dark:text-emerald-300"
                            >
                                <Clipboard className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                )}

                <Input
                    id={`${reactId}-file`}
                    ref={fileInputRef}
                    type="file"
                    accept={accept}
                    className="hidden"
                    disabled={!canPickFile}
                    onChange={onFileChange}
                    aria-label={`Upload ${label}`}
                />
            </div>

            <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(file) => void doUpload(file)} label={label} />
        </div>
    );
}
