'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useHrOnboardingValidation } from '@/hooks/useHrOnboardingValidation';
import { OnboardingDocumentTile } from '@/components/hr/OnboardingDocumentTile';
import { DocumentPreviewModal, DocumentPreviewTarget } from '@/components/hr/DocumentPreviewModal';

// One tile per document — KYC is expanded into its 6 subtypes as individual
// tiles (Aadhaar, PAN, DL / LLR, Voter ID, UAN, Photo) rather than one "KYC"
// tile behind a subtype dropdown. This list intentionally mirrors the public
// joinee form exactly (app/apply/onboarding/[token]/page.tsx) — the 4
// HR-issued categories (Joining Kit, Appointment Letter, BGV Report,
// Original Certificate Acknowledgement) are deliberately excluded here; they
// are things HR gives TO the employee, not things collected during
// onboarding review, and are managed post-provisioning on
// /dashboard/hr/employee-documents instead. `fieldKey` matches the `doc_*`
// rows seeded in prisma/seeders/hr-onboarding-field-config.seeder.ts —
// drives the red-asterisk hint only (cosmetic, same as every other section;
// not a hard submission/approval gate).
const TILE_DEFS: { label: string; category: string; subtype: string | null; fieldKey: string }[] = [
    { label: 'Aadhaar', category: 'KYC', subtype: 'Aadhaar', fieldKey: 'doc_KYC_AADHAAR' },
    { label: 'PAN', category: 'KYC', subtype: 'PAN', fieldKey: 'doc_KYC_PAN' },
    { label: 'DL / LLR', category: 'KYC', subtype: 'DL / LLR', fieldKey: 'doc_KYC_DL' },
    { label: 'Voter ID', category: 'KYC', subtype: 'Voter ID', fieldKey: 'doc_KYC_VOTER_ID' },
    { label: 'UAN', category: 'KYC', subtype: 'UAN', fieldKey: 'doc_KYC_UAN' },
    { label: 'Photo', category: 'KYC', subtype: 'Photo', fieldKey: 'doc_KYC_PHOTO' },
    { label: 'Resume', category: 'RESUME', subtype: null, fieldKey: 'doc_RESUME' },
    { label: 'Education Certificate', category: 'EDUCATION_CERTIFICATE', subtype: null, fieldKey: 'doc_EDUCATION_CERTIFICATE' },
    { label: 'Pre-Application Assessment', category: 'PRE_APPLICATION_ASSESSMENT', subtype: null, fieldKey: 'doc_PRE_APPLICATION_ASSESSMENT' },
    { label: 'Bank Passbook', category: 'BANK_PASSBOOK', subtype: null, fieldKey: 'doc_BANK_PASSBOOK' },
    { label: 'Relieving Letter / Payslip', category: 'RELIEVING_LETTER_PAYSLIP', subtype: null, fieldKey: 'doc_RELIEVING_LETTER_PAYSLIP' },
];

interface DocumentRow {
    id: string;
    category: string;
    subtype: string | null;
    fileUrl: string;
    fileName: string;
    mimeType?: string;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
    uploaderType: 'HR' | 'JOINEE';
    uploadedByName: string | null;
    uploadedAt: string;
    uploadedBy: { id: string; firstName: string; lastName: string } | null;
}

interface Props {
    requestId: string;
    /** Upload/delete disabled once the request has been provisioned (APPROVED). */
    readOnly?: boolean;
    /** Whether documents can be deleted (default: true if not readOnly). */
    allowDelete?: boolean;
    /** Whether documents can be downloaded (default: true). */
    allowDownload?: boolean;
}

// Reused as-is in Manual Entry's Documents tab and the request detail
// dialog's Documents tab. The public joinee page does NOT use this component
// — it has its own smaller, plain-fetch implementation, since apiClient
// assumes an authenticated session that doesn't exist there.
export function OnboardingDocumentUploader({ requestId, readOnly, allowDelete = true, allowDownload = true }: Props) {
    const { toast } = useToast();
    const [documents, setDocuments] = useState<DocumentRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [previewTarget, setPreviewTarget] = useState<DocumentPreviewTarget | null>(null);
    const { isRequired } = useHrOnboardingValidation();

    const fetchDocuments = useCallback(async () => {
        try {
            const res = await apiClient.get<DocumentRow[]>(`/hr/onboarding/${requestId}/documents`);
            if (res.success && res.data) setDocuments(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch documents.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [requestId, toast]);

    useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

    const findExisting = (category: string, subtype: string | null) =>
        documents.find((d) => d.category === category && d.subtype === subtype) ?? null;

    const uploadTo = async (category: string, subtype: string | null, file: File) => {
        try {
            // A tile represents one slot — replacing it means the old row for
            // this exact category+subtype is gone, not accumulating alongside.
            const existing = findExisting(category, subtype);
            if (existing) {
                await apiClient.delete(`/hr/onboarding/${requestId}/documents/${existing.id}`);
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('category', category);
            if (subtype) formData.append('subtype', subtype);

            const res = await apiClient.post(`/hr/onboarding/${requestId}/documents`, formData);
            if (!res.success) throw new Error(res.error || 'Upload failed');
            await fetchDocuments();
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Upload failed.', variant: 'destructive' });
        }
    };

    const deleteDoc = async (docId: string, fileName: string) => {
        try {
            const res = await apiClient.delete(`/hr/onboarding/${requestId}/documents/${docId}`);
            if (!res.success) throw new Error(res.error || 'Failed to remove document');
            toast({ title: 'Removed', description: `${fileName} removed.` });
            await fetchDocuments();
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to remove document.', variant: 'destructive' });
        }
    };

    const downloadDoc = async (fileUrl: string) => {
        try {
            const res = await apiClient.get<{ url: string }>(`/storage/signed-url?key=${encodeURIComponent(fileUrl)}`);
            if (res.success && res.data?.url) {
                window.open(res.data.url, '_blank', 'noopener,noreferrer');
            } else {
                toast({ title: 'Error', description: 'Could not resolve document URL.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not resolve document URL.', variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <p className="text-sm text-slate-500 py-4">Loading documents...</p>;
    }

    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {TILE_DEFS.map((def) => {
                    const existing = findExisting(def.category, def.subtype);
                    return (
                        <OnboardingDocumentTile
                            key={`${def.category}:${def.subtype ?? ''}`}
                            label={def.label}
                            required={isRequired(def.fieldKey)}
                            existingDoc={existing ? {
                                id: existing.id,
                                fileName: existing.fileName,
                                status: existing.status,
                                fileUrl: existing.fileUrl,
                                mimeType: existing.mimeType,
                            } : null}
                            onUpload={(file) => uploadTo(def.category, def.subtype, file)}
                            imageCategory={def.subtype === 'Photo' ? 'portrait' : 'document'}
                            onDelete={allowDelete && existing ? () => deleteDoc(existing.id, existing.fileName) : undefined}
                            onDownload={allowDownload && existing ? () => downloadDoc(existing.fileUrl) : undefined}
                            onPreview={existing ? () => setPreviewTarget({
                                title: def.label,
                                fileUrl: existing.fileUrl,
                                fileName: existing.fileName,
                                mimeType: existing.mimeType,
                            }) : undefined}
                            readOnly={readOnly}
                        />
                    );
                })}
            </div>

            <DocumentPreviewModal
                open={!!previewTarget}
                onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
                document={previewTarget}
                onDownload={allowDownload && previewTarget ? () => downloadDoc(previewTarget.fileUrl) : undefined}
            />
        </>
    );
}
