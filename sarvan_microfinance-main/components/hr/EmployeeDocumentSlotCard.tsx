'use client';

import React, { useRef, useState, useId } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    CheckCircle2,
    Clock,
    AlertCircle,
    Eye,
    Download,
    RefreshCw,
    Trash2,
    Upload,
    Plus,
    FileText,
    Loader2,
    Check,
    X,
} from 'lucide-react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { compressImageForCategory, type ImageCategory } from '@/app/lib/image-compress';
import type { DocumentRow } from '@/components/hr/DocumentThumbnail';
import { toDisplayDate } from '@/app/lib/date-format';

export interface DocumentSlotDef {
    id: string;
    title: string;
    category: string;
    subtype: string | null;
    group: 'kyc' | 'academic' | 'hr';
    allowMultiple?: boolean;
    imageCategory?: ImageCategory;
}

interface Props {
    slot: DocumentSlotDef;
    documents: DocumentRow[];
    onUpload: (file: File, category: string, subtype: string | null) => Promise<void>;
    onReplace: (file: File, documentId: string) => Promise<void>;
    onDelete: (document: DocumentRow) => void;
    onPreview: (document: DocumentRow) => void;
    onDownload: (fileUrl: string) => void;
    onVerify?: (document: DocumentRow) => Promise<void>;
    onReject?: (document: DocumentRow) => void;
    canDelete?: boolean;
    canVerify?: boolean;
    currentUserId?: string;
}

function MiniDocPreview({ doc }: { doc: DocumentRow }) {
    const signedUrl = useSignedUrl(doc.fileUrl);
    const isImage = doc.mimeType?.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(doc.fileName);
    const isPdf = doc.mimeType === 'application/pdf' || /\.pdf$/i.test(doc.fileName);

    if (isImage) {
        return (
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-primary/20 bg-slate-50 dark:border-sidebar-accent/50 dark:bg-slate-900">
                {signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signedUrl} alt={doc.fileName} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
                    </div>
                )}
            </div>
        );
    }

    if (isPdf) {
        return (
            <div className="relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                <FileText className="h-5 w-5" />
                <span className="text-[8px] font-bold tracking-wider">PDF</span>
            </div>
        );
    }

    return (
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <FileText className="h-5 w-5" />
            <span className="text-[7px] font-bold uppercase">
                {doc.fileName.split('.').pop()?.slice(0, 4) || 'FILE'}
            </span>
        </div>
    );
}

// Single document row item component with actions
function DocumentItemView({
    doc,
    onPreview,
    onDownload,
    onReplace,
    onDelete,
    onVerify,
    onReject,
    canDelete,
    canVerify,
    currentUserId,
    imageCategory,
}: {
    doc: DocumentRow;
    onPreview: (doc: DocumentRow) => void;
    onDownload: (url: string) => void;
    onReplace: (file: File, documentId: string) => Promise<void>;
    onDelete: (doc: DocumentRow) => void;
    onVerify?: (doc: DocumentRow) => Promise<void>;
    onReject?: (doc: DocumentRow) => void;
    canDelete?: boolean;
    canVerify?: boolean;
    currentUserId?: string;
    imageCategory?: ImageCategory;
}) {
    const replaceInputId = useId();
    const replaceInputRef = useRef<HTMLInputElement>(null);
    const [isReplacing, setIsReplacing] = useState(false);

    const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        let processedFile = file;
        if (file.type.startsWith('image/')) {
            try {
                const res = await compressImageForCategory(file, imageCategory || 'document');
                processedFile = res.compressedFile;
            } catch {
                // Fall back to original file
            }
        }

        setIsReplacing(true);
        try {
            await onReplace(processedFile, doc.id);
        } finally {
            setIsReplacing(false);
        }
    };

    const status = doc.status;
    const isUploader = doc.uploadedBy && doc.uploadedBy.id === currentUserId;
    const canReviewThisDoc = canVerify && !isUploader && status === 'PENDING';

    return (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 last:flex-1 dark:border-slate-800 dark:bg-slate-900/30">
            {/* Status & Filename */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                        className="cursor-pointer transition-transform hover:scale-105 shrink-0"
                        onClick={() => onPreview(doc)}
                        title="Click to preview"
                    >
                        <MiniDocPreview doc={doc} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 break-words text-xs font-semibold text-foreground [overflow-wrap:anywhere] dark:text-slate-200" title={doc.fileName}>
                            {doc.fileName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                            {toDisplayDate(new Date(doc.uploadedAt))}
                            {doc.uploadedBy ? ` · By ${doc.uploadedBy.firstName}` : ''}
                        </p>
                        {status === 'VERIFIED' && doc.verifiedBy && (
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate">
                                Verified by {doc.verifiedBy.firstName}
                            </p>
                        )}
                    </div>
                </div>

                {/* Status Badge */}
                {status === 'VERIFIED' && (
                    <Badge className="text-[10px] px-1.5 py-0 h-5 font-medium bg-emerald-600 hover:bg-emerald-600 text-white gap-1 shrink-0">
                        <CheckCircle2 className="h-3 w-3" />
                        VERIFIED
                    </Badge>
                )}
                {status === 'PENDING' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-medium border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1 shrink-0">
                        <Clock className="h-3 w-3" />
                        PENDING
                    </Badge>
                )}
                {status === 'REJECTED' && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 font-medium gap-1 shrink-0">
                        <AlertCircle className="h-3 w-3" />
                        REJECTED
                    </Badge>
                )}
            </div>

            {/* Rejection Notice */}
            {status === 'REJECTED' && doc.rejectionReason && (
                <div className="rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 p-1.5 text-[11px] text-red-700 dark:text-red-300">
                    <span className="font-semibold">Reason: </span>
                    {doc.rejectionReason}
                </div>
            )}

            {/* Pending Review Actions */}
            {canReviewThisDoc && (
                <div className="flex items-center gap-1.5 pt-1">
                    <Button
                        size="sm"
                        onClick={() => onVerify?.(doc)}
                        className="flex-1 h-6 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    >
                        <Check className="h-3 w-3 mr-1" />
                        Verify
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onReject?.(doc)}
                        className="flex-1 h-6 text-[11px] border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                        <X className="h-3 w-3 mr-1" />
                        Reject
                    </Button>
                </div>
            )}

            {/* Action Buttons Row: Preview, Download, Replace, Delete */}
            <div className="mt-auto flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-slate-200/60 pt-1.5 dark:border-slate-800">
                <div className="flex items-center gap-0.5">
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onPreview(doc)}
                        className="h-7 px-1.5 sm:px-2 text-xs gap-1 text-sidebar-accent hover:text-primary dark:text-slate-300 dark:hover:text-white shrink-0"
                        title="Preview Document"
                    >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Preview</span>
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDownload(doc.fileUrl)}
                        className="h-7 px-1.5 sm:px-2 text-xs gap-1 text-sidebar-accent hover:text-primary dark:text-slate-300 dark:hover:text-white shrink-0"
                        title="Download Document"
                    >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download</span>
                    </Button>
                </div>

                <div className="ml-auto flex items-center gap-0.5">
                    <input
                        id={replaceInputId}
                        ref={replaceInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={handleReplaceFile}
                    />
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={isReplacing}
                        onClick={() => replaceInputRef.current?.click()}
                        className="h-7 px-1.5 sm:px-2 text-xs gap-1 text-sidebar-accent hover:text-primary dark:text-slate-300 dark:hover:text-white shrink-0"
                        title="Replace Document"
                    >
                        {isReplacing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <>
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Replace</span>
                            </>
                        )}
                    </Button>

                    {canDelete && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDelete(doc)}
                            className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20 shrink-0"
                            title="Delete Document"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

export function EmployeeDocumentSlotCard({
    slot,
    documents,
    onUpload,
    onReplace,
    onDelete,
    onPreview,
    onDownload,
    onVerify,
    onReject,
    canDelete = false,
    canVerify = false,
    currentUserId,
}: Props) {
    const uploadInputId = useId();
    const addAnotherInputId = useId();
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const addAnotherInputRef = useRef<HTMLInputElement>(null);

    const [isUploading, setIsUploading] = useState(false);

    const isMissing = documents.length === 0;

    const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        let processedFile = file;
        if (file.type.startsWith('image/')) {
            try {
                const res = await compressImageForCategory(file, slot.imageCategory || 'document');
                processedFile = res.compressedFile;
            } catch {
                // Fall back to original file
            }
        }

        setIsUploading(true);
        try {
            await onUpload(processedFile, slot.category, slot.subtype);
        } finally {
            setIsUploading(false);
        }
    };

    // ─── MISSING STATE ──────────────────────────────────────────────────────────
    if (isMissing) {
        return (
            <Card className="flex h-full min-w-0 flex-col justify-between gap-0 overflow-hidden border-dashed border-2 border-slate-300 dark:border-sidebar-accent/50 bg-slate-50/60 dark:bg-slate-900/20 hover:border-primary/50 transition-colors p-3.5 sm:p-4 min-h-[170px]">
                <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h4 className="break-words font-semibold text-sm text-foreground dark:text-slate-100 leading-tight">
                                {slot.title}
                            </h4>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono mt-0.5">
                                {slot.subtype ? `${slot.category} · ${slot.subtype}` : slot.category}
                            </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 h-5 font-medium border-slate-300 text-slate-600 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                            MISSING
                        </Badge>
                    </div>
                </div>

                <div className="mt-4 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
                    <input
                        id={uploadInputId}
                        ref={uploadInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={handleUploadFile}
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={isUploading}
                        onClick={() => uploadInputRef.current?.click()}
                        className="w-full text-xs font-medium border-primary/40 text-primary hover:bg-primary hover:text-white dark:border-emerald-500/50 dark:text-emerald-400 dark:hover:bg-emerald-600 dark:hover:text-white"
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                Upload
                            </>
                        )}
                    </Button>
                </div>
            </Card>
        );
    }

    // ─── UPLOADED STATE (SINGLE OR MULTI-COPY) ──────────────────────────────────
    return (
        <Card className="flex h-full min-w-0 flex-col gap-0 overflow-hidden border border-primary/20 dark:border-sidebar-accent bg-white/90 dark:bg-brand-green-darker/40 shadow-sm hover:shadow-md transition-shadow p-3.5 sm:p-4 min-h-[170px]">
            <div className="flex flex-1 flex-col gap-3">
                {/* Slot Title Header */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <div className="min-w-0">
                        <h4 className="break-words font-semibold text-sm text-foreground dark:text-slate-100" title={slot.title}>
                            {slot.title}
                        </h4>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono">
                            {slot.subtype ? `${slot.category} · ${slot.subtype}` : slot.category}
                        </p>
                    </div>

                    {slot.allowMultiple && documents.length > 1 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-medium shrink-0">
                            {documents.length} files
                        </Badge>
                    )}
                </div>

                {/* Document Items List (each document rendered independently with its own status & actions) */}
                <div className="flex flex-1 flex-col gap-2">
                    {documents.map((doc) => (
                        <DocumentItemView
                            key={doc.id}
                            doc={doc}
                            onPreview={onPreview}
                            onDownload={onDownload}
                            onReplace={onReplace}
                            onDelete={onDelete}
                            onVerify={onVerify}
                            onReject={onReject}
                            canDelete={canDelete}
                            canVerify={canVerify}
                            currentUserId={currentUserId}
                            imageCategory={slot.imageCategory}
                        />
                    ))}
                </div>
            </div>

            {/* "+ Add Another" Button for Multi-Copy Slots */}
            {slot.allowMultiple && (
                <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <input
                        id={addAnotherInputId}
                        ref={addAnotherInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={handleUploadFile}
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={isUploading}
                        onClick={() => addAnotherInputRef.current?.click()}
                        className="w-full text-xs font-medium border-dashed border-primary/40 text-primary hover:bg-primary/10 dark:text-emerald-400"
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                Add Another Document
                            </>
                        )}
                    </Button>
                </div>
            )}
        </Card>
    );
}
