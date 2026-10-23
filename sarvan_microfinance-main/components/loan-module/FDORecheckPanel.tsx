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
    DocPreviewDialog, readClipboardImage, docLabel, getRecheckInfo,
    type PanelDoc, type StageReviewFields,
} from './RecheckReuploadShared';

// ─── Types ──────────────────────────────────────────────────────────────────

type KYCDoc = StageReviewFields & {
    id: string;
    documentType: string;
    documentNumber: string | null;
    fileUrl: string;
    fileName: string;
    mimeType: string | null;
    revisionNo: number;
};

type DynamicStage = { levelOrder: number; roleSlug: string; stageName: string; pendingStatus: string; retakeStatus: string };

type ClientRemarks = {
    bmRemarks: string | null;
    amRemarks: string | null;
    qcRemarks: string | null;
    finalRemarks: string | null;
};

interface Props {
    /** Client business id (e.g. Sarvam033-C0070002) */
    clientId: string;
    onClose: () => void;
    /** Called after the client has been successfully resubmitted */
    onResubmitted: () => void;
}

const RETAKE = 'RETAKE_REQUIRED';

// Whole-client (stage-level) retake: BM/AM/QC/Admin clicked "Request Retake"
// on the client as a whole instead of flagging one specific document. In this
// case no KYC document gets bmDecision/amDecision/qcDecision = RETAKE_REQUIRED
// — the only signal is client.approvalStatus itself — so docFlaggedBy() below
// finds nothing and the panel falls back to this stage-level remark (and lets
// the FDO re-upload any document) instead of silently showing everything as OK.
const STAGE_RETAKE_REMARK_FIELD: Record<string, keyof ClientRemarks> = {
    BM_RETAKE_REQUIRED:              'bmRemarks',
    AM_RETAKE_REQUIRED:              'amRemarks',
    QC_VERIFICATION_RETAKE_REQUIRED: 'qcRemarks',
    FINAL_RETAKE_REQUIRED:           'finalRemarks',
};

// Where FDO_RESUBMIT actually sends the client next — must match the
// resubmitTargetMap in app/api/approval/clients/[clientId]/action/route.ts.
const RESUBMIT_DESTINATION: Record<string, string> = {
    BM_RETAKE_REQUIRED:              'BM',
    AM_RETAKE_REQUIRED:              'BM',                    // full restart: BM → AM again
    QC_VERIFICATION_RETAKE_REQUIRED: 'BM',                   // full restart: BM → AM → QC again
    FINAL_RETAKE_REQUIRED:           'Admin (Final Approval)',
};

function docFlaggedBy(doc: KYCDoc): string | null {
    // Dynamic workflow: any configured stage (built-in or custom role) — latest level first.
    const dyn = doc.stageDecisions ? [...doc.stageDecisions].reverse().find((s) => s.decision === RETAKE) : undefined;
    if (dyn) return dyn.stageName;
    if (doc.bmDecision === RETAKE) return 'BM';
    if (doc.amDecision === RETAKE) return 'AM';
    if (doc.qcDecision === RETAKE) return 'QC';
    return null;
}

const asPanelDoc = (d: KYCDoc): PanelDoc => ({ id: d.id, documentType: d.documentType, fileUrl: d.fileUrl, fileName: d.fileName, mimeType: d.mimeType });

/**
 * FDO-facing inline recheck/re-upload panel — rendered as an expanded row in the
 * Loan Tracker's "Recheck" tab. Flagged documents ("Needs Re-upload") get large
 * cards with Upload / Camera / Paste and are required before submitting; every
 * other document can optionally be replaced from the smaller cards below. A
 * whole-client (stage-level) retake flags no single document, so there everything
 * is optional and the reviewer's remark says what to redo. Finally pushes the client back to
 * whichever stage requested it — BM, AM, QC, or Admin (a Final-stage retake skips
 * straight back to Admin since BM/AM/QC already signed off).
 *
 * Cycle this completes:
 *   BM retake:  FDO → BM → AM → (BM flags image) → FDO → BM → AM → QC → Admin
 *   AM retake:  FDO → BM → AM → (AM flags image) → FDO → BM → AM → QC → Admin
 *   QC retake:  FDO → BM → AM → QC → (QC flags image) → FDO → BM → AM → QC → Admin
 */
export function FDORecheckPanel({ clientId, onClose, onResubmitted }: Props) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [docs, setDocs] = useState<KYCDoc[]>([]);
    const [approvalStatus, setApprovalStatus] = useState<string>('');
    const [remarks, setRemarks] = useState<ClientRemarks | null>(null);
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [compressionStats, setCompressionStats] = useState<Record<string, CompressionResult>>({});
    const [submitting, setSubmitting] = useState(false);
    const [cameraDocId, setCameraDocId] = useState<string | null>(null);
    // Re-uploading clears a doc's RETAKE flag server-side (and a re-upload may come
    // back as a new revision with a new id), so track re-uploaded document TYPES in
    // this session to keep those cards in "Needs Re-upload" showing the fresh image.
    const [reuploadedTypes, setReuploadedTypes] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<PanelDoc | null>(null);
    // Document types the reviewer flagged — fixed on first load, since re-uploading
    // clears a flag server-side. Only these are required; every other image is optional.
    const [requiredTypes, setRequiredTypes] = useState<Set<string> | null>(null);
    // Dynamic approval workflow stages (empty = legacy BM → AM → QC).
    const [workflowStages, setWorkflowStages] = useState<DynamicStage[]>([]);
    const [levelRetakeRemark, setLevelRetakeRemark] = useState<string | null>(null);

    const fetchDetail = useCallback(async () => {
        try {
            const res = await apiClient.get<{
                client: ClientRemarks & {
                    approvalStatus: string;
                    kycDocuments: KYCDoc[];
                    approvalHistory?: Array<{ action: string; remarks: string | null }>;
                };
                dynamicWorkflowActive?: boolean;
                workflowStages?: DynamicStage[];
            }>(
                `/approval/clients/${clientId}`
            );
            if (res.success && res.data) {
                const kycDocs = res.data.client.kycDocuments || [];
                setDocs(kycDocs);
                setApprovalStatus(res.data.client.approvalStatus);
                setWorkflowStages(res.data.dynamicWorkflowActive ? res.data.workflowStages ?? [] : []);
                // Latest whole-client LEVEL_RETAKE remark (custom-role stages have no
                // client-level remark column) — history is newest-first.
                setLevelRetakeRemark(
                    res.data.client.approvalHistory?.find((h) => h.action === 'LEVEL_RETAKE_REQUESTED')?.remarks ?? null
                );
                setRequiredTypes((prev) => prev ?? new Set(kycDocs.filter((d) => docFlaggedBy(d)).map((d) => d.documentType)));
                setRemarks({
                    bmRemarks: res.data.client.bmRemarks,
                    amRemarks: res.data.client.amRemarks,
                    qcRemarks: res.data.client.qcRemarks,
                    finalRemarks: res.data.client.finalRemarks,
                });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load client documents', variant: 'destructive' });
            }
        } finally {
            setLoading(false);
        }
    }, [clientId, toast]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);

    const flaggedDocs = docs.filter((d) => docFlaggedBy(d) && requiredTypes?.has(d.documentType));
    const allFlaggedResolved = flaggedDocs.length === 0;

    // Stage-level (whole-client) retake reason — set when the reviewer used
    // "Request Retake" on the client overall rather than flagging one document.
    const stageRemarkField = STAGE_RETAKE_REMARK_FIELD[approvalStatus];
    const retakingStage = workflowStages.find((s) => s.retakeStatus === approvalStatus);
    // Dynamic workflow: a custom-role stage's whole-client retake remark lives only in history.
    const stageRetakeReason = (stageRemarkField ? remarks?.[stageRemarkField] ?? null : null)
        ?? (retakingStage ? levelRetakeRemark : null);
    // Must match FDO_RESUBMIT in the action route: with a dynamic workflow every
    // stage retake restarts at the first configured stage; final retake → final.
    const resubmitDestination = workflowStages.length > 0
        ? (approvalStatus === 'FINAL_RETAKE_REQUIRED' ? 'Admin (Final Approval)' : workflowStages[0].stageName)
        : RESUBMIT_DESTINATION[approvalStatus] ?? 'BM';

    // Required = the images the reviewer flagged; every other image can optionally be
    // replaced. A whole-client retake flags none, so everything is optional there and
    // the FDO re-uploads whatever the reviewer's remark asks for.
    const actionDocs = docs.filter((d) => requiredTypes?.has(d.documentType));
    const optionalDocs = docs.filter((d) => !requiredTypes?.has(d.documentType));
    const requiredReuploaded = [...reuploadedTypes].filter((t) => requiredTypes?.has(t)).length;

    const handleFileSelected = async (doc: KYCDoc, file: File) => {
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
            const res = await apiClient.post<{ document: KYCDoc }>(
                `/approval/clients/${clientId}/documents/${doc.id}/reupload`,
                formData
            );
            if (res.success) {
                toast({ title: 'Uploaded', description: `${docLabel(doc.documentType)} re-uploaded.` });
                setReuploadedTypes((prev) => new Set(prev).add(doc.documentType));
                await fetchDetail();
            } else {
                toast({ title: 'Upload failed', description: res.error || 'Could not re-upload document', variant: 'destructive' });
            }
        } finally {
            setUploadingId(null);
        }
    };

    const handlePaste = async (doc: KYCDoc) => {
        try {
            const file = await readClipboardImage();
            if (file) await handleFileSelected(doc, file);
            else toast({ title: 'No image found', description: 'Clipboard does not contain an image. Copy an image first.', variant: 'destructive' });
        } catch {
            toast({ title: 'Paste failed', description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.', variant: 'destructive' });
        }
    };

    // An already-APPROVED client never leaves that status (admin-edit-no-reapproval
    // policy) — re-uploading the flagged document(s) already cleared the per-document
    // decision back to PENDING, so there's nothing to resubmit. Just close out.
    const isApprovedClient = approvalStatus === 'APPROVED';

    const handleResubmit = async () => {
        if (isApprovedClient) {
            toast({ title: 'Updated', description: 'Document re-uploaded. No further action needed — client remains approved.' });
            onResubmitted();
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiClient.post<unknown>(`/approval/clients/${clientId}/action`, {
                action: 'FDO_RESUBMIT',
            });
            if (res.success) {
                toast({ title: 'Resubmitted', description: `Client sent back to ${resubmitDestination} for review.` });
                onResubmitted();
            } else {
                toast({ title: 'Resubmit failed', description: res.error || 'Could not resubmit client', variant: 'destructive' });
            }
        } finally {
            setSubmitting(false);
        }
    };

    const cameraDoc = docs.find((d) => d.id === cameraDocId) ?? null;

    return (
        <>
            <RecheckPanelFrame
                title="Recheck & Re-upload Documents"
                meta={approvalStatus && <Badge variant="outline" className="text-[10px]">{approvalStatus.replace(/_/g, ' ')}</Badge>}
                loading={loading}
                onClose={onClose}
                footerNote={allFlaggedResolved
                    ? (isApprovedClient ? 'All recheck images are re-uploaded.' : `All recheck images are re-uploaded — submit to send back to ${resubmitDestination}.`)
                    : `${flaggedDocs.length} recheck image${flaggedDocs.length !== 1 ? 's' : ''} still need re-upload before you can submit. Other images are optional.`}
                submitLabel={isApprovedClient ? 'Done' : `Submit to ${resubmitDestination}`}
                canSubmit={allFlaggedResolved}
                submitting={submitting}
                onSubmit={handleResubmit}
            >
                <StageRemarkBanner remark={stageRetakeReason} />

                <section>
                    <SectionHeading
                        icon={<Upload className="h-4 w-4 text-rose-600" />}
                        title="Needs Re-upload (required)"
                        right={<ProgressPill done={requiredReuploaded} total={actionDocs.length} />}
                    />
                    {actionDocs.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            No single image was flagged — re-upload below whatever the reviewer&apos;s remark asks for, then submit.
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
                                        reuploaded={reuploadedTypes.has(doc.documentType)}
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
                            title="Other Member Images"
                            right={<span className="text-xs text-muted-foreground">Optional — re-upload only if you want to replace</span>}
                        />
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                            {optionalDocs.map((doc) => (
                                <ReuploadDocCard
                                    key={doc.id}
                                    compact
                                    doc={asPanelDoc(doc)}
                                    recheck={null}
                                    reuploaded={reuploadedTypes.has(doc.documentType)}
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
