'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Upload, CheckCircle2, ImagePlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { compressImage, type CompressionResult } from '@/app/lib/image-compress';
import { CameraCapture } from '@/components/ui/CameraCapture';
import {
    RecheckPanelFrame, StageRemarkBanner, SectionHeading, ProgressPill, ReuploadDocCard,
    ReferenceDocGrid, DocPreviewDialog, readClipboardImage, docLabel, getRecheckInfo,
    type PanelDoc, type StageReviewFields,
} from './RecheckReuploadShared';

// ─── Types ──────────────────────────────────────────────────────────────────

type RenewalDoc = StageReviewFields & {
    id: string;
    documentType: string;
    fileUrl: string;
    fileName: string | null;
    coApplicantId: string | null;
    /** Stage name that flagged this image for retake (null = not flagged). */
    retakeFlaggedBy?: string | null;
};

type RenewalHistoryEntry = {
    id: string;
    action: string;
    remarks: string | null;
    createdAt: string;
    newState: string | null;
};

type MemberKycDoc = {
    id: string;
    documentType: string;
    fileUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
    coApplicantId: string | null;
    revisionNo: number;
};

type RenewalDetailResponse = {
    loan: {
        id: string;
        loanNumber: string;
        renewalApprovalStatus: string;
        client: {
            clientId: string;
            firstName: string;
            lastName: string;
            /** Member's enrollment KYC (not loan-scoped) — shown view-only for reference. */
            kycDocuments?: MemberKycDoc[];
        };
        renewalKycDocuments: RenewalDoc[];
        renewalHistory: RenewalHistoryEntry[];
    };
    /** Configured approval chain — firstStageName is where a (non-final) resubmit restarts. */
    workflow?: { firstStageName: string | null };
};

interface Props {
    /** Renewal Loan id (Loan.id) */
    loanId: string;
    onClose: () => void;
    /** Called after the renewal has been successfully resubmitted */
    onResubmitted: () => void;
}

// Which stage flagged this image for retake — resolved server-side from the
// configured workflow (built-in BM/AM/QC columns or a custom role's stage review).
function docFlaggedBy(doc: RenewalDoc): string | null {
    return doc.retakeFlaggedBy ?? null;
}

/**
 * Ids of the images a reviewer flagged ONE BY ONE in the current review round —
 * read from renewalHistory's `RENEWAL_DOC_RETAKE_REQUIRED` rows (written by
 * renewal-kyc-documents/[id]/review, newState carries the documentId) since the
 * FDO's last resubmit. This survives re-upload (which clears the doc's own flag),
 * unlike the per-doc decision columns, and excludes images that only got flagged by
 * an older whole-renewal "Request Retake" that marked the entire batch.
 */
function individuallyFlaggedIds(history: RenewalHistoryEntry[]): Set<string> {
    const ids = new Set<string>();
    for (const h of history) { // newest-first
        if (h.action === 'FDO_RESUBMITTED_RENEWAL') break; // start of the current round
        if (h.action !== 'RENEWAL_DOC_RETAKE_REQUIRED' || !h.newState) continue;
        try {
            const state = JSON.parse(h.newState) as { documentId?: string };
            if (state.documentId) ids.add(state.documentId);
        } catch { /* malformed row — ignore */ }
    }
    return ids;
}

const docKey = (d: { coApplicantId: string | null; documentType: string }) => `${d.coApplicantId ?? ''}:${d.documentType}`;
const asPanelDoc = (d: RenewalDoc): PanelDoc => ({ id: d.id, documentType: d.documentType, fileUrl: d.fileUrl, fileName: d.fileName, mimeType: null });

/**
 * FDO-facing inline recheck/re-upload panel for a Renewal Loan — rendered as an
 * expanded row in the Loan Tracker's Recheck tab (the renewal counterpart of
 * FDORecheckPanel). A renewal's re-uploaded house images / location QR / gas bill are
 * loan-scoped KYC rows (KYC.loanId set), so they never appear in the client-level panel.
 *
 * Only the images a reviewer flagged are required ("Needs Re-upload"); this renewal's
 * other images can optionally be replaced, and the member's enrollment KYC (Aadhaar,
 * Voter ID, …) is shown view-only below for reference.
 *
 * Re-uploads go through renewal-kyc-documents/[documentId]/reupload (one image at a
 * time), then "Submit" calls renewal-action FDO_RESUBMIT to send the renewal back.
 */
export function FDORenewalRecheckPanel({ loanId, onClose, onResubmitted }: Props) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<RenewalDetailResponse['loan'] | null>(null);
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [compressionStats, setCompressionStats] = useState<Record<string, CompressionResult>>({});
    const [submitting, setSubmitting] = useState(false);
    const [cameraDocId, setCameraDocId] = useState<string | null>(null);
    const [optionalUploadedIds, setOptionalUploadedIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<PanelDoc | null>(null);
    const [firstStageName, setFirstStageName] = useState<string | null>(null);

    const fetchDetail = useCallback(async () => {
        try {
            const res = await apiClient.get<RenewalDetailResponse>(`/loans/renewal-application?loanId=${loanId}`);
            if (res.success && res.data) {
                setDetail(res.data.loan);
                setFirstStageName(res.data.workflow?.firstStageName ?? null);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load renewal documents', variant: 'destructive' });
            }
        } finally {
            setLoading(false);
        }
    }, [loanId, toast]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);

    const docs = detail?.renewalKycDocuments ?? [];
    const status = detail?.renewalApprovalStatus ?? '';
    // Must match renewal-action's FDO_RESUBMIT: a final-review retake returns to
    // final review; any stage retake restarts at the first configured stage.
    const resubmitDestination = status === 'FINAL_RETAKE_REQUIRED'
        ? 'Admin (Final Approval)'
        : firstStageName ?? 'the first approval stage';
    // Latest reviewer remark on the renewal as a whole (renewalHistory is newest-first).
    const stageRetakeReason = detail?.renewalHistory.find((h) => h.action === 'RENEWAL_RETAKE_REQUESTED')?.remarks ?? null;

    // Required ("Needs Re-upload") = exactly the images the reviewer flagged one by one
    // this round — a re-uploaded one stays listed (green) since its flag is cleared.
    // Only when the reviewer flagged nothing individually (a whole-renewal retake)
    // is every currently-flagged image required. Everything else is optional.
    const individualIds = individuallyFlaggedIds(detail?.renewalHistory ?? []);
    const requiredIdSet = individualIds.size > 0
        ? individualIds
        : new Set(docs.filter((d) => docFlaggedBy(d)).map((d) => d.id));
    const actionDocs = docs.filter((d) => requiredIdSet.has(d.id));
    const pendingRequired = actionDocs.filter((d) => docFlaggedBy(d));
    const allRequiredResolved = pendingRequired.length === 0;
    const reuploadedCount = actionDocs.length - pendingRequired.length;
    const optionalDocs = docs.filter((d) => !requiredIdSet.has(d.id));

    // View-only reference: the member's enrollment KYC — minus any type this renewal
    // re-captured (its newer image wins), keeping only the latest revision of each
    // (the API orders by revisionNo desc).
    const renewalKeys = new Set(docs.map(docKey));
    const referenceDocs: PanelDoc[] = [];
    const seenMemberKeys = new Set<string>();
    for (const d of detail?.client.kycDocuments ?? []) {
        const key = docKey(d);
        if (!d.fileUrl || renewalKeys.has(key) || seenMemberKeys.has(key)) continue;
        seenMemberKeys.add(key);
        referenceDocs.push({ id: d.id, documentType: d.documentType, fileUrl: d.fileUrl, fileName: d.fileName, mimeType: d.mimeType });
    }

    const handleFileSelected = async (doc: RenewalDoc, file: File) => {
        setUploadingId(doc.id);
        try {
            const compressionResult = await compressImage(file, doc.documentType);
            const { compressedFile, previewUrl } = compressionResult;
            URL.revokeObjectURL(previewUrl);
            if (compressionResult.wasCompressed) {
                setCompressionStats((prev) => ({ ...prev, [doc.id]: compressionResult }));
            }

            const formData = new FormData();
            formData.append('file', compressedFile);
            const res = await apiClient.post<{ document: RenewalDoc }>(
                `/approval/loans/${loanId}/renewal-kyc-documents/${doc.id}/reupload`,
                formData
            );
            if (res.success) {
                toast({ title: 'Uploaded', description: `${docLabel(doc.documentType)} re-uploaded.` });
                if (!requiredIdSet.has(doc.id)) setOptionalUploadedIds((prev) => new Set(prev).add(doc.id));
                await fetchDetail();
            } else {
                toast({ title: 'Upload failed', description: res.error || 'Could not re-upload document', variant: 'destructive' });
            }
        } finally {
            setUploadingId(null);
        }
    };

    const handlePaste = async (doc: RenewalDoc) => {
        try {
            const file = await readClipboardImage();
            if (file) await handleFileSelected(doc, file);
            else toast({ title: 'No image found', description: 'Clipboard does not contain an image. Copy an image first.', variant: 'destructive' });
        } catch {
            toast({ title: 'Paste failed', description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.', variant: 'destructive' });
        }
    };

    const handleResubmit = async () => {
        setSubmitting(true);
        try {
            const res = await apiClient.post<unknown>(`/approval/loans/${loanId}/renewal-action`, {
                action: 'FDO_RESUBMIT',
            });
            if (res.success) {
                toast({ title: 'Resubmitted', description: `Renewal sent back to ${resubmitDestination} for review.` });
                onResubmitted();
            } else {
                toast({ title: 'Resubmit failed', description: res.error || 'Could not resubmit renewal', variant: 'destructive' });
            }
        } finally {
            setSubmitting(false);
        }
    };

    const cameraDoc = docs.find((d) => d.id === cameraDocId) ?? null;

    return (
        <>
            <RecheckPanelFrame
                title="Renewal Re-upload"
                meta={detail && (
                    <>
                        <span>Loan <span className="font-medium text-foreground">#{detail.loanNumber}</span></span>
                        <Badge variant="outline" className="text-[10px]">{status.replace(/_/g, ' ')}</Badge>
                    </>
                )}
                loading={loading}
                onClose={onClose}
                footerNote={allRequiredResolved
                    ? `All recheck images are re-uploaded — submit to send back to ${resubmitDestination}.`
                    : `${pendingRequired.length} recheck image${pendingRequired.length !== 1 ? 's' : ''} still need re-upload before you can submit. Other images are optional.`}
                submitLabel={`Submit to ${resubmitDestination}`}
                canSubmit={allRequiredResolved && !!detail}
                submitting={submitting}
                onSubmit={handleResubmit}
            >
                <StageRemarkBanner remark={stageRetakeReason} />

                <section>
                    <SectionHeading
                        icon={<Upload className="h-4 w-4 text-rose-600" />}
                        title="Needs Re-upload (required)"
                        right={<ProgressPill done={reuploadedCount} total={actionDocs.length} />}
                    />
                    {actionDocs.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            No images are flagged for re-upload. You can submit this renewal back for review.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {actionDocs.map((doc) => {
                                const flaggedBy = docFlaggedBy(doc);
                                return (
                                    <ReuploadDocCard
                                        key={doc.id}
                                        doc={asPanelDoc(doc)}
                                        recheck={getRecheckInfo(doc)}
                                        reuploaded={!docFlaggedBy(doc)}
                                        uploading={uploadingId === doc.id}
                                        compression={compressionStats[doc.id]}
                                        canUpload={!!flaggedBy}
                                        onFile={(file) => handleFileSelected(doc, file)}
                                        onCamera={() => setCameraDocId(doc.id)}
                                        onPaste={() => handlePaste(doc)}
                                        onPreview={() => setPreview(asPanelDoc(doc))}
                                    />
                                );
                            })}
                        </div>
                    )}
                </section>

                {optionalDocs.length > 0 && (
                    <section>
                        <SectionHeading
                            icon={<ImagePlus className="h-4 w-4 text-muted-foreground" />}
                            title="Other Renewal Images"
                            right={<span className="text-xs text-muted-foreground">Optional — re-upload only if you want to replace</span>}
                        />
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                            {optionalDocs.map((doc) => (
                                <ReuploadDocCard
                                    key={doc.id}
                                    compact
                                    doc={asPanelDoc(doc)}
                                    recheck={null}
                                    reuploaded={optionalUploadedIds.has(doc.id)}
                                    uploading={uploadingId === doc.id}
                                    compression={compressionStats[doc.id]}
                                    canUpload
                                    onFile={(file) => handleFileSelected(doc, file)}
                                    onCamera={() => setCameraDocId(doc.id)}
                                    onPaste={() => handlePaste(doc)}
                                    onPreview={() => setPreview(asPanelDoc(doc))}
                                />
                            ))}
                        </div>
                    </section>
                )}

                <ReferenceDocGrid docs={referenceDocs} onPreview={setPreview} />
            </RecheckPanelFrame>

            <DocPreviewDialog doc={preview} onClose={() => setPreview(null)} />

            <CameraCapture
                open={!!cameraDoc}
                onClose={() => setCameraDocId(null)}
                onCapture={(file) => {
                    if (cameraDoc) void handleFileSelected(cameraDoc, file);
                    setCameraDocId(null);
                }}
                label={cameraDoc ? docLabel(cameraDoc.documentType) : undefined}
            />
        </>
    );
}
