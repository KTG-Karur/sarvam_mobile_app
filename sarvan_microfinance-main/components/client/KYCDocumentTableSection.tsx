'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Upload,
    Trash2,
    Eye,
    FileText,
    Image as ImageIcon,
    Loader2,
    Camera,
    Download,
    Clipboard,
    ImageDown,
    MapPin,
} from 'lucide-react';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { StorageImage, StorageIframe } from '@/components/storage/StorageMedia';
import { downloadStorageFile } from '@/app/lib/storage-url-client';
import { compressImage, type CompressionResult } from '@/app/lib/image-compress';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import {
    CLIENT_KYC_DOCUMENT_TYPES,
    CO_APPLICANT_KYC_DOCUMENT_TYPES,
    appendKycUploadOwnerAndCategory,
    getKycDocumentTypeLabel,
} from '@/app/lib/kyc-document-types';
import { PageLoader } from '@/components/ui/page-loader';

interface KYCDocument {
    id: string;
    documentType: string;
    fileName: string;
    fileType: string;
    uploadDate: string;
    fileUrl?: string;
}

interface KYCDocumentTableSectionProps {
    selectedClient: string;
    clientInternalId: string;
    clientCreatedAt: string;
    documents: KYCDocument[];
    isLoading: boolean;
    onDocumentUploaded: () => void;
    permissionPage: string;
    scope: 'client' | 'co_applicant';
    title: string;
    /** Road (driving) distance from branch/center, in metres — shown next to House Image 1 (client scope only). */
    distanceFromBranchMeters?: number | null;
    distanceFromCenterMeters?: number | null;
    isLoadingDistance?: boolean;
}

const formatKycDistance = (meters: number | null | undefined): string => {
    if (meters == null) return '—';
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
};

export function KYCDocumentTableSection({
    selectedClient,
    clientInternalId,
    documents,
    isLoading,
    onDocumentUploaded,
    scope,
    title,
    distanceFromBranchMeters,
    distanceFromCenterMeters,
    isLoadingDistance,
}: KYCDocumentTableSectionProps) {
    const { toast } = useToast();
    const [uploadingRowType, setUploadingRowType] = useState<string | null>(null);
    const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
    const [deleteDialogDoc, setDeleteDialogDoc] = useState<KYCDocument | null>(null);
    const [viewDialogDoc, setViewDialogDoc] = useState<KYCDocument | null>(null);
    const [cameraOpenForType, setCameraOpenForType] = useState<string | null>(null);
    const [compressionStats, setCompressionStats] = useState<Record<string, CompressionResult>>({});

    const docTypes = scope === 'client' ? CLIENT_KYC_DOCUMENT_TYPES : CO_APPLICANT_KYC_DOCUMENT_TYPES;

    // One ref per document type slot
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const handleRowUpload = async (docTypeValue: string, file: File) => {
        setUploadingRowType(docTypeValue);
        try {
            // Compress with document-type-aware settings; skip non-image files (PDF etc.)
            const compressionResult = file.type.startsWith('image/')
                ? await compressImage(file, docTypeValue)
                : null;
            const compressed = compressionResult?.compressedFile ?? file;
            if (compressionResult) {
                URL.revokeObjectURL(compressionResult.previewUrl);
                setCompressionStats(prev => ({ ...prev, [docTypeValue]: compressionResult }));
            }

            const formData = new FormData();
            formData.append('clientId', selectedClient);
            formData.append('documentType', docTypeValue);
            formData.append('file', compressed);
            appendKycUploadOwnerAndCategory(formData, docTypeValue);

            const response = await fetch('/api/kyc/aadhaar/upload', {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || 'Upload failed');
            }
            toast({
                title: 'Document uploaded',
                description: compressionResult?.wasCompressed
                    ? `${getKycDocumentTypeLabel(docTypeValue)} uploaded — ${compressionResult.originalSizeLabel} → ${compressionResult.compressedSizeLabel} (saved ${compressionResult.reductionPercent}%).`
                    : `${getKycDocumentTypeLabel(docTypeValue)} uploaded successfully.`,
            });
            onDocumentUploaded();
        } catch (error) {
            toast({
                title: 'Upload failed',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setUploadingRowType(null);
            if (fileInputRefs.current[docTypeValue]) {
                fileInputRefs.current[docTypeValue]!.value = '';
            }
        }
    };

    const handlePasteUpload = async (docTypeValue: string) => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((t) => t.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], `pasted_${Date.now()}.png`, { type: imageType });
                    await handleRowUpload(docTypeValue, file);
                    return;
                }
            }
            toast({ title: 'No image found', description: 'Clipboard does not contain an image.', variant: 'destructive' });
        } catch {
            toast({ title: 'Paste failed', description: 'Could not access clipboard. Allow clipboard permission or use Ctrl+V.', variant: 'destructive' });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteDialogDoc) return;
        setDeletingDocId(deleteDialogDoc.id);
        try {
            const result = await apiClient.delete(
                `/clients/${selectedClient}/kyc-documents?documentId=${deleteDialogDoc.id}`
            );
            if (!result.success) throw new Error((result as any).error || 'Delete failed');
            toast({ title: 'Document deleted', description: `${deleteDialogDoc.fileName} has been deleted.` });
            onDocumentUploaded();
            setDeleteDialogDoc(null);
        } catch (error) {
            toast({
                title: 'Delete failed',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setDeletingDocId(null);
        }
    };

    const handleDownload = async (doc: KYCDocument) => {
        const ok = await downloadStorageFile(doc.fileUrl, doc.fileName || 'kyc-document');
        if (!ok) {
            toast({ title: 'Download unavailable', description: 'File URL is not available.', variant: 'destructive' });
        }
    };

    if (isLoading) {
        return (
            <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                <CardHeader>
                    <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <PageLoader fullScreen={false} />
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            {/* Hidden file inputs — one per document type */}
            {docTypes.map((docType) => (
                <input
                    key={docType.value}
                    ref={(el) => { fileInputRefs.current[docType.value] = el; }}
                    type="file"
                    accept={docType.accept}
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleRowUpload(docType.value, file);
                    }}
                />
            ))}

            {/* Camera capture (renders one at a time) */}
            {cameraOpenForType && (
                <CameraCapture
                    open={true}
                    onCapture={(file) => {
                        handleRowUpload(cameraOpenForType, file);
                        setCameraOpenForType(null);
                    }}
                    onClose={() => setCameraOpenForType(null)}
                />
            )}

            <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                <CardHeader>
                    <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
                        {docTypes.map((docType) => {
                            const doc = documents.find((d) => d.documentType === docType.value);
                            const isPdf = doc?.fileType === 'application/pdf' || doc?.fileType?.includes('pdf');
                            const isUploading = uploadingRowType === docType.value;
                            const stats = compressionStats[docType.value];
                            // Km From Branch / Km From Center only make sense next to the
                            // house-visit photo — shown when the parent passed distance data.
                            const showDistance = docType.value === 'house_image_1'
                                && (distanceFromBranchMeters !== undefined || distanceFromCenterMeters !== undefined || isLoadingDistance);

                            return (
                                <div
                                    key={docType.value}
                                    className="flex flex-col rounded-lg border border-slate-200 dark:border-sidebar-accent/40 bg-white dark:bg-brand-green-darker/20 overflow-hidden hover:shadow-sm transition-shadow"
                                >
                                    {/* Thumbnail */}
                                    <div className="relative aspect-[4/3] bg-slate-50 dark:bg-brand-green-darker/50">
                                        {doc ? (
                                            doc.fileUrl && !isPdf ? (
                                                <StorageImage
                                                    src={doc.fileUrl}
                                                    alt={docType.label}
                                                    className="h-full w-full object-cover cursor-pointer"
                                                    onClick={() => setViewDialogDoc(doc)}
                                                />
                                            ) : (
                                                <div
                                                    className="h-full w-full flex items-center justify-center cursor-pointer"
                                                    onClick={() => setViewDialogDoc(doc)}
                                                >
                                                    <FileText className="h-8 w-8 text-red-400" />
                                                </div>
                                            )
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center border-2 border-dashed border-slate-200 dark:border-sidebar-accent">
                                                <ImageIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                                            </div>
                                        )}
                                        {doc && (
                                            <span className="absolute top-1.5 right-1.5 rounded-full bg-primary text-white text-[10px] font-semibold px-1.5 py-0.5 shadow">
                                                ✓
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex-1 flex flex-col gap-1.5 p-2.5">
                                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight" title={docType.label}>
                                            {docType.label}
                                        </p>

                                        {showDistance && (
                                            <div className="flex items-start gap-1 text-[10px] leading-tight text-primary dark:text-primary bg-green-50 dark:bg-brand-green-darker/50 rounded px-1.5 py-1">
                                                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                                {isLoadingDistance ? (
                                                    <span>Calculating distance…</span>
                                                ) : (
                                                    <span>
                                                        {formatKycDistance(distanceFromBranchMeters)} branch · {formatKycDistance(distanceFromCenterMeters)} center
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {stats?.wasCompressed && (
                                            <div
                                                title={`${stats.originalSizeLabel} → ${stats.compressedSizeLabel} (saved ${stats.reductionPercent}%)`}
                                                className="flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-400"
                                            >
                                                <ImageDown className="h-3 w-3 shrink-0" /> Optimised {stats.reductionPercent}%
                                            </div>
                                        )}

                                        <div className="mt-auto flex items-center gap-1 flex-wrap pt-1">
                                            {isUploading ? (
                                                <div className="flex items-center gap-1 text-[11px] text-primary">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                                                </div>
                                            ) : doc ? (
                                                <>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        onClick={() => setViewDialogDoc(doc)}
                                                        title="View"
                                                    >
                                                        <Eye className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        onClick={() => fileInputRefs.current[docType.value]?.click()}
                                                        title="Replace"
                                                    >
                                                        <Upload className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        onClick={() => handlePasteUpload(docType.value)}
                                                        title="Paste from clipboard"
                                                    >
                                                        <Clipboard className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        className="text-red-500 hover:text-red-600 hover:border-red-300"
                                                        onClick={() => setDeleteDialogDoc(doc)}
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        className="border-primary/30 text-sidebar-accent hover:border-primary hover:text-foreground"
                                                        onClick={() => fileInputRefs.current[docType.value]?.click()}
                                                        title="Upload"
                                                    >
                                                        <Upload className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        className="border-primary/30 text-sidebar-accent hover:border-primary"
                                                        onClick={() => setCameraOpenForType(docType.value)}
                                                        title="Camera"
                                                    >
                                                        <Camera className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon-sm"
                                                        className="border-primary/30 text-sidebar-accent hover:border-primary"
                                                        onClick={() => handlePasteUpload(docType.value)}
                                                        title="Paste from clipboard"
                                                    >
                                                        <Clipboard className="h-3.5 w-3.5" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* View dialog */}
            <Dialog open={!!viewDialogDoc} onOpenChange={(open) => !open && setViewDialogDoc(null)}>
                <DialogContent className="sm:max-w-[90vw] sm:max-h-[90vh] p-0 overflow-hidden">
                    <div className="flex flex-col h-full">
                        <DialogHeader className="p-6 pb-0">
                            <DialogTitle>
                                {viewDialogDoc ? getKycDocumentTypeLabel(viewDialogDoc.documentType) : ''}
                            </DialogTitle>
                            <DialogDescription>{viewDialogDoc?.fileName}</DialogDescription>
                        </DialogHeader>
                        <div className="flex-1 min-h-0 p-6 pt-4">
                            {!viewDialogDoc?.fileUrl ? (
                                <div className="w-full h-[60vh] bg-brand-green-tint dark:bg-sidebar-accent rounded-lg flex items-center justify-center">
                                    <p className="text-slate-500 dark:text-slate-400">Preview unavailable</p>
                                </div>
                            ) : viewDialogDoc.fileType?.startsWith('image/') ? (
                                <div className="w-full h-[60vh] bg-brand-green-tint dark:bg-sidebar-accent rounded-lg overflow-auto flex items-center justify-center">
                                    <StorageImage
                                        src={viewDialogDoc.fileUrl}
                                        alt={viewDialogDoc.fileName}
                                        className="max-w-full max-h-full object-contain"
                                    />
                                </div>
                            ) : (
                                <StorageIframe
                                    src={viewDialogDoc.fileUrl}
                                    title={viewDialogDoc.fileName}
                                    className="w-full h-[60vh] rounded-lg border border-primary/20 dark:border-sidebar-accent"
                                />
                            )}
                        </div>
                        <DialogFooter className="p-6 pt-0">
                            <Button variant="outline" onClick={() => setViewDialogDoc(null)}>Close</Button>
                            <Button onClick={() => viewDialogDoc && handleDownload(viewDialogDoc)}>
                                <Download className="h-4 w-4 mr-2" /> Download
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation dialog */}
            <Dialog open={!!deleteDialogDoc} onOpenChange={(open) => !open && setDeleteDialogDoc(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Document</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this document? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    {deleteDialogDoc && (
                        <div className="py-4">
                            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-sidebar-accent rounded-lg">
                                {deleteDialogDoc.fileType === 'application/pdf' ? (
                                    <FileText className="h-8 w-8 text-red-500" />
                                ) : (
                                    <StorageImage
                                        src={deleteDialogDoc.fileUrl}
                                        alt=""
                                        className="h-8 w-8 rounded object-cover"
                                    />
                                )}
                                <div>
                                    <p className="text-sm font-medium text-foreground dark:text-slate-100">
                                        {getKycDocumentTypeLabel(deleteDialogDoc.documentType)}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{deleteDialogDoc.fileName}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteDialogDoc(null)}
                            disabled={!!deletingDocId}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteConfirm}
                            disabled={!!deletingDocId}
                        >
                            {deletingDocId ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>
                            ) : (
                                <><Trash2 className="h-4 w-4 mr-2" /> Delete</>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
