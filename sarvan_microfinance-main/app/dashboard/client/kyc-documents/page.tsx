'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { FileText, Upload, Database, Printer } from 'lucide-react';
import { KYCDocumentForm } from '@/components/client/KYCDocumentForm';
import { KYCDocumentTable, KYCDocument } from '@/components/client/KYCDocumentTable';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CLIENT_KYC_DOCUMENT_TYPES } from '@/app/lib/kyc-document-types';
import { PrintKYCDocuments } from '@/components/client/PrintKYCDocuments';
import { Button } from '@/components/ui/button';

interface KycDocumentApiResponse {
    clientId: string;
    documents: Array<{
        id: string;
        documentType: string;
        fileUrl: string | null;
        fileName: string | null;
        fileSize: number | null;
        mimeType: string | null;
        uploadedAt: string;
    }>;
}

export default function KYCDocumentsPage() {
    const { toast } = useToast();
    const [selectedClient, setSelectedClient] = useState('');
    const [selectedClientName, setSelectedClientName] = useState('');
    const [documents, setDocuments] = useState<KYCDocument[]>([]);
    const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

    useEffect(() => {
        if (!selectedClient) {
            setDocuments([]);
            return;
        }

        void fetchDocuments(selectedClient);
    }, [selectedClient]);

    const fetchDocuments = async (clientId: string) => {
        setIsLoadingDocuments(true);
        try {
            const result = await apiClient.get<KycDocumentApiResponse>(`/clients/${clientId}/kyc-documents`);
            if (!result.success || !result.data) {
                throw new Error(result.error || 'Failed to load KYC documents');
            }

            const mappedDocuments: KYCDocument[] = result.data.documents.map((doc) => ({
                id: doc.id,
                documentType: doc.documentType,
                fileName: doc.fileName || 'Unnamed file',
                fileType: doc.mimeType || 'application/octet-stream',
                uploadDate: doc.uploadedAt,
                fileUrl: doc.fileUrl || undefined,
            }));

            setDocuments(mappedDocuments);
        } catch (error) {
            console.error('Error fetching KYC documents:', error);
            setDocuments([]);
            toast({
                title: 'Failed to load documents',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingDocuments(false);
        }
    };

    const handleClientChange = (clientId: string, clientName?: string) => {
        setSelectedClient(clientId);
        if (clientName) {
            setSelectedClientName(clientName);
        }
    };

    const handleDocumentUploaded = (clientId: string) => {
        if (!clientId) {
            return;
        }

        if (clientId !== selectedClient) {
            setSelectedClient(clientId);
            return;
        }

        void fetchDocuments(clientId);
    };

    const handleDocumentDeleted = () => {
        if (!selectedClient) {
            return;
        }

        void fetchDocuments(selectedClient);
    };

    const imageCount = useMemo(
        () => documents.filter((doc) => doc.fileType.startsWith('image/')).length,
        [documents],
    );

    return (
        <ProtectedRoute requiredPermission="KYC_UPDATE">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    <div className="mb-8">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                    <FileText className="h-6 w-6 text-white" />
                                    <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                                </div>
                                <div>
                                    <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">KYC Documents</h1>
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                        Upload and manage client KYC documents securely
                                    </p>
                                </div>
                            </div>
                            
                            {selectedClient && (
                                <PrintKYCDocuments 
                                    clientId={selectedClient}
                                    clientName={selectedClientName || selectedClient}
                                />
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-6">
                            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary" />

                                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                            <Upload className="h-5 w-5 text-primary dark:text-primary" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-xl">Upload Document</CardTitle>
                                            <CardDescription>Select client and upload KYC documents</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <KYCDocumentForm
                                        onClientChange={handleClientChange}
                                        onDocumentUploaded={handleDocumentUploaded}
                                    />
                                </CardContent>
                            </Card>

                            <Card className="border border-primary/30 dark:border-sidebar-accent bg-green-50/50 dark:bg-green-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/50">
                                                <FileText className="h-4 w-4 text-primary dark:text-primary" />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <h4 className="text-sm font-semibold text-foreground dark:text-green-100">Supported Document Types</h4>
                                            <ul className="text-xs text-sidebar-accent dark:text-green-300 space-y-0.5">
                                                {CLIENT_KYC_DOCUMENT_TYPES.map((documentType) => (
                                                    <li key={documentType.value}>• {documentType.label}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="space-y-6">
                            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                                <div className="h-1.5 bg-gradient-to-r from-primary via-purple-600 to-primary" />

                                <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                            <Database className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-xl">Uploaded Documents</CardTitle>
                                            <CardDescription>View and manage uploaded KYC documents</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <KYCDocumentTable
                                        selectedClient={selectedClient}
                                        documents={documents}
                                        isLoading={isLoadingDocuments}
                                        onDocumentDeleted={handleDocumentDeleted}
                                    />
                                </CardContent>
                            </Card>

                            <div className="grid grid-cols-2 gap-4">
                                <Card className="border border-primary/20 dark:border-sidebar-accent">
                                    <CardContent className="pt-6">
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-primary dark:text-primary">{documents.length}</p>
                                            <p className="text-xs text-sidebar-accent dark:text-slate-400 mt-1">Total Documents</p>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border border-primary/20 dark:border-sidebar-accent">
                                    <CardContent className="pt-6">
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{imageCount}</p>
                                            <p className="text-xs text-sidebar-accent dark:text-slate-400 mt-1">Image Files</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 pb-6">
                    <DashboardFooter />
                </div>
            </div>
        </ProtectedRoute>
    );
}
