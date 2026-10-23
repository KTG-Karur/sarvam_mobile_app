'use client';

import { useRef } from 'react';
import { StorageImage, StorageLink } from '@/components/storage/StorageMedia';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Loader2, FileText, ExternalLink, AlertTriangle, CheckCircle2, Camera, Clipboard, Upload, Eye, X, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CompressionResult } from '@/app/lib/image-compress';
import { getKycDocumentTypeLabel } from '@/app/lib/kyc-document-types';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

// Shared building blocks for the FDO's inline Recheck & Re-upload panels
// (FDORecheckPanel — new-loan / client KYC, FDORenewalRecheckPanel — renewal loan).
// Both panels render inside the Loan Tracker's Recheck table as an expanded row.

export const docLabel = (documentType: string) => getKycDocumentTypeLabel(documentType);

/** A document shown in a panel — either a re-upload card or a view-only tile. */
export type PanelDoc = {
    id: string;
    documentType: string;
    fileUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
};

type Reviewer = { firstName: string; lastName: string; employeeId: string | null } | null;

/** Per-stage review fields a KYC row carries (client KYC and renewal KYC alike). */
export type StageReviewFields = {
    bmDecision: string; amDecision: string; qcDecision: string;
    bmRemark?: string | null; amRemark?: string | null; qcRemark?: string | null;
    bmReviewedAt?: string | null; amReviewedAt?: string | null; qcReviewedAt?: string | null;
    bmReviewer?: Reviewer; amReviewer?: Reviewer; qcReviewer?: Reviewer;
    retakeReason: string | null;
    /** Dynamic approval workflow: decision per configured stage (any role), in level order. */
    stageDecisions?: Array<{
        roleSlug: string; stageName: string; decision: string;
        remark: string | null; reviewedAt: string | null; reviewer: Reviewer;
    }>;
};

/** Who raised a recheck on one image, when, and that stage's own remark for it. */
export type RecheckInfo = {
    /** 'BM' / 'AM' / 'QC', or a dynamic workflow stage's name. */
    by: string;
    reviewerName: string | null;
    employeeId: string | null;
    at: string | null;
    remark: string | null;
};

/** The recheck raised on a document — latest stage first (QC → AM → BM) — or null if none. */
export function getRecheckInfo(doc: StageReviewFields): RecheckInfo | null {
    // Dynamic workflow: every configured stage (any role) — latest level first.
    if (doc.stageDecisions && doc.stageDecisions.length > 0) {
        const dyn = [...doc.stageDecisions].reverse().find((s) => s.decision === 'RETAKE_REQUIRED');
        if (dyn) {
            return {
                by: dyn.stageName,
                reviewerName: dyn.reviewer ? `${dyn.reviewer.firstName} ${dyn.reviewer.lastName}`.trim() : null,
                employeeId: dyn.reviewer?.employeeId ?? null,
                at: dyn.reviewedAt ?? null,
                remark: dyn.remark || doc.retakeReason || null,
            };
        }
    }
    const stages = [
        { by: 'QC' as const, dec: doc.qcDecision, remark: doc.qcRemark, at: doc.qcReviewedAt, reviewer: doc.qcReviewer },
        { by: 'AM' as const, dec: doc.amDecision, remark: doc.amRemark, at: doc.amReviewedAt, reviewer: doc.amReviewer },
        { by: 'BM' as const, dec: doc.bmDecision, remark: doc.bmRemark, at: doc.bmReviewedAt, reviewer: doc.bmReviewer },
    ];
    const hit = stages.find((s) => s.dec === 'RETAKE_REQUIRED');
    if (!hit) return null;
    return {
        by: hit.by,
        reviewerName: hit.reviewer ? `${hit.reviewer.firstName} ${hit.reviewer.lastName}`.trim() : null,
        employeeId: hit.reviewer?.employeeId ?? null,
        at: hit.at ?? null,
        remark: hit.remark || doc.retakeReason || null,
    };
}

const STAGE_NAME: Record<string, string> = { BM: 'Branch Manager', AM: 'Area Manager', QC: 'Quality Check' };

/** Prominent "Recheck raised by …" block with that reviewer's own remark for this image. */
function RecheckRaisedBanner({ info }: { info: RecheckInfo }) {
    return (
        <div className="border-b border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-900/60 dark:bg-rose-950/30">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                    <AlertTriangle className="h-3 w-3" /> Recheck raised by {info.by}
                </span>
                <span className="text-[11px] text-rose-700 dark:text-rose-300">
                    {STAGE_NAME[info.by] ?? info.by}
                    {info.reviewerName && <> · <span className="font-semibold">{info.reviewerName}</span></>}
                    {info.employeeId && <span className="ml-1 rounded border border-rose-200 bg-white/70 px-1 font-mono text-[10px] dark:bg-transparent">{info.employeeId}</span>}
                    {info.at && <> · {toDisplayDate(new Date(info.at))}</>}
                </span>
            </div>
            <div className="mt-2 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-transparent dark:text-rose-200">
                <span className="text-[10px] font-bold uppercase tracking-wide text-rose-500">Remark</span>
                <p className="break-words">{info.remark ? <>&ldquo;{info.remark}&rdquo;</> : <span className="italic text-rose-400">No remark given</span>}</p>
            </div>
        </div>
    );
}

/** Image (object-contain, fills its positioned parent) or a file link for non-images. */
export function DocMedia({ doc }: { doc: PanelDoc }) {
    const label = docLabel(doc.documentType);
    const isImage = doc.mimeType ? doc.mimeType.startsWith('image/') : /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.fileName || doc.fileUrl || '');
    if (doc.fileUrl && isImage) return <StorageImage src={doc.fileUrl} alt={label} fill className="object-contain p-1" />;
    if (doc.fileUrl) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1">
                <FileText className="h-8 w-8 text-slate-400" />
                <StorageLink href={doc.fileUrl} className="flex items-center gap-1 text-xs underline">
                    <ExternalLink className="h-3 w-3" /> View file
                </StorageLink>
            </div>
        );
    }
    return <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>;
}

/** Outer frame of an inline panel: header (title, meta, close), scrolling body, footer. */
export function RecheckPanelFrame({
    title, meta, loading, onClose, children, footerNote, submitLabel, canSubmit, submitting, onSubmit,
}: {
    title: string;
    meta?: React.ReactNode;
    loading: boolean;
    onClose: () => void;
    children: React.ReactNode;
    footerNote: string;
    submitLabel: string;
    canSubmit: boolean;
    submitting: boolean;
    onSubmit: () => void;
}) {
    return (
        <div className="overflow-hidden rounded-xl border-2 border-rose-200 bg-card shadow-sm dark:border-rose-900/60">
            <div className="flex items-start justify-between gap-3 border-b bg-rose-50/60 px-4 py-3 dark:bg-rose-950/20">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{title}</p>
                    {meta && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onClose} title="Close">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <div className="space-y-5 bg-muted/20 p-4">
                {loading ? <PageLoader fullScreen={false} /> : children}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{footerNote}</p>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
                    <Button type="button" size="sm" disabled={!canSubmit || submitting} onClick={onSubmit}>
                        {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                        {submitLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}

/** Reviewer's whole-stage remark (no single image flagged, or extra context). */
export function StageRemarkBanner({ remark }: { remark: string | null }) {
    if (!remark) return null;
    return (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
                <p className="font-semibold">Reviewer remark</p>
                <p>&ldquo;{remark}&rdquo;</p>
            </div>
        </div>
    );
}

export function SectionHeading({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground">{icon}{title}</h3>
            {right}
        </div>
    );
}

export function ProgressPill({ done, total }: { done: number; total: number }) {
    if (total === 0) return null;
    return (
        <span className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold',
            done >= total ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700',
        )}>
            {done} of {total} re-uploaded
        </span>
    );
}

/** One image the FDO must (or may) re-upload — large preview + Upload / Camera / Paste. */
export function ReuploadDocCard({
    doc, recheck, reuploaded, uploading, compression, canUpload, compact, onFile, onCamera, onPaste, onPreview,
}: {
    /** Smaller card for optional (not flagged) images. */
    compact?: boolean;
    doc: PanelDoc;
    /** The recheck raised on this image (stage, reviewer, remark), or null when not flagged. */
    recheck: RecheckInfo | null;
    /** Re-uploaded in this session — shown with a green badge. */
    reuploaded: boolean;
    uploading: boolean;
    compression?: CompressionResult;
    canUpload: boolean;
    onFile: (file: File) => void;
    onCamera: () => void;
    onPaste: () => void;
    onPreview: () => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    return (
        <div className={cn(
            'flex flex-col overflow-hidden rounded-xl border-2 bg-card shadow-sm',
            recheck ? 'border-rose-400 ring-2 ring-rose-100 dark:ring-rose-950' : reuploaded ? 'border-emerald-300' : 'border-border',
        )}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="text-sm font-semibold text-foreground">{docLabel(doc.documentType)}</span>
                {recheck ? (
                    <Badge variant="outline" className="whitespace-nowrap border-rose-200 bg-rose-50 text-[11px] text-rose-700">
                        Pending re-upload
                    </Badge>
                ) : reuploaded ? (
                    <Badge variant="outline" className="whitespace-nowrap border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Re-uploaded
                    </Badge>
                ) : compact ? (
                    <Badge variant="outline" className="whitespace-nowrap text-[10px] text-muted-foreground">Optional</Badge>
                ) : null}
            </div>

            {recheck && <RecheckRaisedBanner info={recheck} />}

            <button
                type="button"
                onClick={onPreview}
                className={cn('relative block w-full cursor-zoom-in bg-slate-100 dark:bg-slate-900', compact ? 'h-36' : 'h-56')}
            >
                <DocMedia doc={doc} />
                {uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}
            </button>

            {compression && (
                <p className="border-t bg-blue-50/60 px-3 py-1.5 text-[11px] text-blue-700">
                    Compressed: {compression.originalSizeLabel} → {compression.compressedSizeLabel} (saved {compression.reductionPercent}%)
                </p>
            )}

            {canUpload && (
                <div className={cn('mt-auto flex gap-2 border-t', compact ? 'p-2' : 'flex-wrap p-3')}>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) onFile(file);
                            e.target.value = '';
                        }}
                    />
                    {/* Compact cards are narrow — icon-only Camera/Paste so labels never overlap. */}
                    <Button type="button" size="sm" variant={compact ? 'outline' : 'default'} className={cn('flex-1 gap-1.5', compact ? 'h-8 px-2 text-xs' : 'h-9 min-w-[90px]')} disabled={uploading} onClick={() => inputRef.current?.click()}>
                        <Upload className="h-4 w-4 shrink-0" /> Upload
                    </Button>
                    <Button type="button" size="sm" variant="outline" className={cn(compact ? 'h-8 w-9 shrink-0 px-0' : 'h-9 min-w-[90px] flex-1 gap-1.5')} disabled={uploading} onClick={onCamera} title="Take photo">
                        <Camera className="h-4 w-4 shrink-0" />{!compact && ' Camera'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" className={cn(compact ? 'h-8 w-9 shrink-0 px-0' : 'h-9 min-w-[90px] flex-1 gap-1.5')} disabled={uploading} onClick={onPaste} title="Paste image">
                        <Clipboard className="h-4 w-4 shrink-0" />{!compact && ' Paste'}
                    </Button>
                </div>
            )}
        </div>
    );
}

/** View-only thumbnail grid ("no action needed") — tap a tile to enlarge. */
export function ReferenceDocGrid({
    docs, onPreview, tagFor,
}: {
    docs: PanelDoc[];
    onPreview: (doc: PanelDoc) => void;
    /** Optional small tag per tile (e.g. "Renewal"). */
    tagFor?: (doc: PanelDoc) => string | null;
}) {
    if (docs.length === 0) return null;
    return (
        <section>
            <SectionHeading
                icon={<Eye className="h-4 w-4 text-muted-foreground" />}
                title="Member Documents"
                right={<span className="text-xs text-muted-foreground">View only — no action needed · tap to enlarge</span>}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {docs.map((doc) => {
                    const tag = tagFor?.(doc) ?? null;
                    return (
                        <button
                            key={doc.id}
                            type="button"
                            onClick={() => onPreview(doc)}
                            className="overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-md"
                        >
                            <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-900">
                                <DocMedia doc={doc} />
                            </div>
                            <div className="flex items-center justify-between gap-1 border-t px-2.5 py-1.5">
                                <span className="truncate text-xs font-medium text-foreground" title={docLabel(doc.documentType)}>{docLabel(doc.documentType)}</span>
                                {tag && (
                                    <span className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">{tag}</span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

/** Enlarged view of any document. */
export function DocPreviewDialog({ doc, onClose }: { doc: PanelDoc | null; onClose: () => void }) {
    return (
        <Dialog open={!!doc} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="w-[95vw] max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{doc ? docLabel(doc.documentType) : ''}</DialogTitle>
                </DialogHeader>
                {doc && (
                    <div className="relative h-[70vh] w-full rounded-lg bg-slate-100 dark:bg-slate-900">
                        <DocMedia doc={doc} />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Reads the first image off the clipboard, or null if there isn't one. Throws if clipboard access is denied. */
export async function readClipboardImage(): Promise<File | null> {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
            const blob = await item.getType(imageType);
            return new File([blob], `pasted_photo_${Date.now()}.png`, { type: imageType });
        }
    }
    return null;
}
