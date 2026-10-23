'use client';

import { useState } from 'react';
import { Eye, Download, Trash2, FileText, Loader2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getKycDocumentTypeLabel } from '@/components/client/kyc-document-types';
import { StorageImage, StorageIframe } from '@/components/storage/StorageMedia';
import { downloadStorageFile } from '@/app/lib/storage-url-client';

export interface KYCDocument {
    id: string;
    documentType: string;
    fileName: string;
    fileType: string;
    uploadDate: string;
    fileUrl?: string;
}

interface KYCDocumentGridProps {
    selectedClient: string;
    documents: KYCDocument[];
    isLoading?: boolean;
    onDocumentDeleted?: () => void;
    emptyMessage?: string;
}

export function KYCDocumentGrid({
    selectedClient,
    documents,
    isLoading = false,
    onDocumentDeleted,
    emptyMessage = 'No documents uploaded yet',
}: KYCDocumentGridProps) {
    const { toast } = useToast();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<KYCDocument | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleView = (doc: KYCDocument) => {
        setSelectedDocument(doc);
        setViewDialogOpen(true);
    };

    const handleDownload = async (doc: KYCDocument) => {
        const ok = await downloadStorageFile(doc.fileUrl, doc.fileName || 'kyc-document');
        if (!ok) {
            toast({ title: 'Download unavailable', description: 'File URL is not available.', variant: 'destructive' });
        }
    };

    const handleDeleteClick = (doc: KYCDocument) => {
        setSelectedDocument(doc);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!selectedDocument || !selectedClient || isDeleting) return;
        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/clients/${selectedClient}/kyc-documents?documentId=${selectedDocument.id}`);
            if (!result.success) throw new Error(result.error || 'Failed to delete document');
            toast({ title: 'Document deleted', description: `${selectedDocument.fileName} has been deleted.` });
            onDocumentDeleted?.();
            setDeleteDialogOpen(false);
            setSelectedDocument(null);
        } catch (error) {
            toast({
                title: 'Delete failed',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    if (isLoading) {
        return <PageLoader fullScreen={false} />;
    }

    if (documents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-8 rounded-lg border-2 border-dashed border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-brand-green-darker/50">
                <FileText className="h-10 w-10 text-slate-400 dark:text-sidebar-accent mb-2" />
                <p className="text-sm text-sidebar-accent dark:text-slate-400">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {documents.map((doc) => {
                    const isPdf = doc.fileType === 'application/pdf';
                    return (
                        <div
                            key={doc.id}
                            className="relative group rounded-lg overflow-hidden border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker"
                        >
                            <div className="w-full h-24 bg-green-50 dark:bg-brand-green-darker/60 flex items-center justify-center overflow-hidden">
                                {doc.fileUrl && !isPdf ? (
                                    <StorageImage
                                        src={doc.fileUrl}
                                        alt={getKycDocumentTypeLabel(doc.documentType)}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <FileText className="h-10 w-10 text-red-400" />
                                )}
                            </div>

                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-white hover:text-white hover:bg-white/20"
                                    onClick={() => handleView(doc)}
                                    title="View"
                                >
                                    <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-white hover:text-white hover:bg-white/20"
                                    onClick={() => handleDownload(doc)}
                                    title="Download"
                                >
                                    <Download className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-300 hover:text-red-200 hover:bg-white/20"
                                    onClick={() => handleDeleteClick(doc)}
                                    title="Delete"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>

                            <p className="text-xs text-center p-1.5 font-medium text-sidebar-accent dark:text-slate-300 truncate">
                                {getKycDocumentTypeLabel(doc.documentType)}
                            </p>
                        </div>
                    );
                })}
            </div>

            <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
                <DialogContent className="sm:max-w-[90vw] sm:max-h-[90vh] p-0 overflow-hidden">
                    <div className="flex flex-col h-full">
                        <DialogHeader className="p-6 pb-0">
                            <DialogTitle>{selectedDocument ? getKycDocumentTypeLabel(selectedDocument.documentType) : ''}</DialogTitle>
                            <DialogDescription>{selectedDocument?.fileName}</DialogDescription>
                        </DialogHeader>
                        <div className="flex-1 min-h-0 p-6 pt-4">
                            {!selectedDocument?.fileUrl ? (
                                <div className="w-full h-[60vh] bg-brand-green-tint dark:bg-sidebar-accent rounded-lg flex items-center justify-center">
                                    <p className="text-slate-500 dark:text-slate-400">Preview unavailable</p>
                                </div>
                            ) : selectedDocument.fileType?.startsWith('image/') ? (
                                <div className="w-full h-[60vh] bg-brand-green-tint dark:bg-sidebar-accent rounded-lg overflow-auto flex items-center justify-center">
                                    <StorageImage
                                        src={selectedDocument.fileUrl}
                                        alt={selectedDocument.fileName}
                                        className="max-w-full max-h-full object-contain"
                                    />
                                </div>
                            ) : (
                                <StorageIframe
                                    src={selectedDocument.fileUrl}
                                    title={selectedDocument.fileName}
                                    className="w-full h-[60vh] rounded-lg border border-primary/20 dark:border-sidebar-accent"
                                />
                            )}
                        </div>
                        <DialogFooter className="p-6 pt-0">
                            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>Close</Button>
                            <Button onClick={() => selectedDocument && handleDownload(selectedDocument)}>
                                <Download className="h-4 w-4 mr-2" />
                                Download
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Document</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this document? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedDocument && (
                        <div className="py-4">
                            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-sidebar-accent rounded-lg">
                                {selectedDocument.fileType === 'application/pdf' ? (
                                    <FileText className="h-8 w-8 text-red-500" />
                                ) : (
                                    <StorageImage
                                        src={selectedDocument.fileUrl}
                                        alt=""
                                        className="h-8 w-8 rounded object-cover"
                                    />
                                )}
                                <div>
                                    <p className="text-sm font-medium text-foreground dark:text-slate-100">
                                        {getKycDocumentTypeLabel(selectedDocument.documentType)}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{selectedDocument.fileName}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteConfirm} disabled={isDeleting}>
                            {isDeleting ? (
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
