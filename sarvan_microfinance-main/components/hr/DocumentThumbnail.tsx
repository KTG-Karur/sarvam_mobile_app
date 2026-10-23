'use client';

import { Loader2, FileText } from 'lucide-react';
import { useSignedUrl } from '@/hooks/useSignedUrl';

export const CATEGORIES = [
    { value: 'JOINING_KIT', label: 'Joining Kit' },
    { value: 'PRE_APPLICATION_ASSESSMENT', label: 'Pre-Application Assessment' },
    { value: 'KYC', label: 'KYC' },
    { value: 'EDUCATION_CERTIFICATE', label: 'Education Certificate' },
    { value: 'APPOINTMENT_LETTER', label: 'Appointment Letter' },
    { value: 'BANK_PASSBOOK', label: 'Bank Passbook' },
    { value: 'BGV_REPORT', label: 'BGV Report' },
    { value: 'RELIEVING_LETTER_PAYSLIP', label: 'Relieving Letter / Payslip' },
    { value: 'RESUME', label: 'Resume' },
    { value: 'ORIGINAL_CERTIFICATE_ACK', label: 'Original Certificate Acknowledgement' },
];

// Shared with the API's list ordering and duplicate check — one definition.
export { KYC_SUBTYPES } from '@/app/lib/hr/document-order';

export type DocumentRow = {
    id: string;
    category: string;
    subtype: string | null;
    fileUrl: string;
    fileName: string;
    mimeType?: string;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
    uploadedAt: string;
    rejectionReason: string | null;
    uploadedBy: { id: string; firstName: string; lastName: string } | null;
    verifiedBy: { id: string; firstName: string; lastName: string } | null;
};

export function categoryLabel(value: string) {
    return CATEGORIES.find((c) => c.value === value)?.label || value;
}

export function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'VERIFIED') return 'default';
    if (status === 'REJECTED') return 'destructive';
    return 'outline';
}

// Resolves and shows the document's actual image inline (no click-to-preview
// needed) — falls back to a generic file icon for PDFs/anything else.
// A separate component (not inlined in a list's .map()) so useSignedUrl,
// which is only safe as "one hook instance per rendered item", gets its own
// proper component instance per row.
export function DocumentThumbnail({ doc }: { doc: DocumentRow }) {
    const signedUrl = useSignedUrl(doc.fileUrl);
    const isImage = doc.mimeType?.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(doc.fileName);

    if (isImage) {
        return (
            <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                {signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signedUrl} alt={doc.fileName} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900">
            <FileText className="h-6 w-6" />
            <span className="text-[8px] font-bold uppercase tracking-wide">
                {doc.fileName.split('.').pop()?.slice(0, 4) || 'FILE'}
            </span>
        </div>
    );
}
