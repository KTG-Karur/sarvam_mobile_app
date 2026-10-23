'use client';

import { useState } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Eye, Download, Trash2, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getKycDocumentTypeLabel } from '@/components/client/kyc-document-types';
import { StorageImage, StorageIframe } from '@/components/storage/StorageMedia';
import { downloadStorageFile } from '@/app/lib/storage-url-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

export interface KYCDocument {
    id: string;
    documentType: string;
    fileName: string;
    fileType: string;
    uploadDate: string;
    fileUrl?: string;
}

interface KYCDocumentTableProps {
    selectedClient: string;
    documents: KYCDocument[];
    isLoading?: boolean;
    onDocumentDeleted?: () => void;
}

export function KYCDocumentTable({
    selectedClient,
    documents,
    isLoading = false,
    onDocumentDeleted,
}: KYCDocumentTableProps) {
    const { toast } = useToast();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<KYCDocument | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(documents);

    const handleView = (document: KYCDocument) => {
        setSelectedDocument(document);
        setViewDialogOpen(true);
    };

    const handleDownload = async (document: KYCDocument) => {
        const ok = await downloadStorageFile(document.fileUrl, document.fileName || 'kyc-document');
        if (!ok) {
            toast({
                title: 'Download unavailable',
                description: 'File URL is not available for this document.',
                variant: 'destructive',
            });
        }
    };

    const handleDeleteClick = (document: KYCDocument) => {
        setSelectedDocument(document);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!selectedDocument || !selectedClient || isDeleting) {
            return;
        }

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/clients/${selectedClient}/kyc-documents?documentId=${selectedDocument.id}`);
            if (!result.success) {
                throw new Error(result.error || 'Failed to delete document');
            }

            toast({
                title: 'Document deleted',
                description: `${selectedDocument.fileName} has been deleted.`,
            });

            onDocumentDeleted?.();
            setDeleteDialogOpen(false);
            setSelectedDocument(null);
        } catch (error) {
            console.error('Delete KYC document error:', error);
            toast({
                title: 'Delete failed',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) {
            return '--';
        }

        return toDisplayDate(date);
    };

    if (!selectedClient) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-primary/30 dark:border-sidebar-accent rounded-lg bg-green-50 dark:bg-brand-green-darker/50">
                <FileText className="h-16 w-16 text-slate-400 dark:text-sidebar-accent mb-4" />
                <h3 className="text-lg font-semibold text-foreground dark:text-slate-100 mb-2">No Client Selected</h3>
                <p className="text-sm text-sidebar-accent dark:text-slate-400 text-center max-w-md">
                    Select a client to view uploaded KYC documents.
                </p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent rounded-lg bg-green-50 dark:bg-brand-green-darker/50">
                <PageLoader label="Loading documents..." fullScreen={false} />
            </div>
        );
    }

    if (documents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-primary/30 dark:border-sidebar-accent rounded-lg bg-green-50 dark:bg-brand-green-darker/50">
                <FileText className="h-16 w-16 text-slate-400 dark:text-sidebar-accent mb-4" />
                <h3 className="text-lg font-semibold text-foreground dark:text-slate-100 mb-2">No Documents Found</h3>
                <p className="text-sm text-sidebar-accent dark:text-slate-400 text-center max-w-md">
                    Upload Aadhaar front/back for the selected client to see them listed here.
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-4 mb-3">
                <TableSearchInput
                    value={tableSearchQuery}
                    onChange={setTableSearchQuery}
                    placeholder="Search documents..."
                    className="ml-auto"
                />
            </div>
            <div className="rounded-lg border border-primary/20 dark:border-sidebar-accent overflow-x-auto bg-white dark:bg-brand-green-darker">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-green-50 dark:bg-sidebar-accent/50 hover:bg-green-50 dark:hover:bg-sidebar-accent/50">
                            <TableHead className="font-semibold text-foreground dark:text-slate-100">Document Type</TableHead>
                            <TableHead className="font-semibold text-foreground dark:text-slate-100">File Name</TableHead>
                            <TableHead className="font-semibold text-foreground dark:text-slate-100">Upload Date</TableHead>
                            <TableHead className="font-semibold text-foreground dark:text-slate-100 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {searchedRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
                                    No documents match your search.
                                </TableCell>
                            </TableRow>
                        ) : searchedRows.map((document) => (
                            <TableRow key={document.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30 transition-colors">
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        {document.fileType === 'application/pdf' ? (
                                            <FileText className="h-5 w-5 text-red-500" />
                                        ) : (
                                            <ImageIcon className="h-5 w-5 text-primary" />
                                        )}
                                        <span className="font-medium text-foreground dark:text-slate-100">
                                            {getKycDocumentTypeLabel(document.documentType)}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">{document.fileName}</TableCell>
                                <TableCell className="text-sidebar-accent dark:text-slate-300">{formatDate(document.uploadDate)}</TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleView(document)}
                                            className="h-8 w-8 text-primary hover:text-sidebar-accent hover:bg-green-50 dark:text-primary dark:hover:bg-green-950/30"
                                            title="View document"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDownload(document)}
                                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
                                            title="Download document"
                                        >
                                            <Download className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDeleteClick(document)}
                                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                                            title="Delete document"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
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
                        <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                            Close
                        </Button>
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
                                    <ImageIcon className="h-8 w-8 text-primary" />
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
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
