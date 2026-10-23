'use client';

import { useRef, useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { compressImageForCategory, formatBytes } from '@/app/lib/image-compress';
import { STAFF_LOAN_DOCUMENT_ACCEPT, STAFF_LOAN_DOCUMENT_MAX_BYTES } from '@/app/lib/staff-loans/document-rule';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export type UploadedDocument = { fileKey: string; fileName: string; fileSize: number };

const UPLOAD_URL = '/hr/staff-advances/documents/upload';

/**
 * Supporting-document picker of a Staff Advance: the same behaviour as the Staff Loan form (JPG / PNG / PDF up to
 * 5 MB, images compressed in the browser first, the server checks the real file type and compresses again).
 * `uploadFields` are extra multipart fields the server needs: `employeeId` (applying for someone else) or
 * `advanceId` (an approver replacing the file).
 */
export function SupportingDocumentField({ id, label, required, value, onChange, uploadFields, disabled, error, hint }: {
    id: string;
    label: string;
    required?: boolean;
    value: UploadedDocument | null;
    onChange: (next: UploadedDocument | null) => void;
    uploadFields?: Record<string, string>;
    disabled?: boolean;
    error?: string;
    hint?: string;
}) {
    const { toast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');

    const fail = (message: string) => {
        setUploadError(message);
        toast({ title: 'Upload Failed', description: message, variant: 'destructive' });
    };

    const handleSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0];
        event.target.value = '';
        if (!picked) return;
        const isPdf = picked.type === 'application/pdf';
        const isImage = picked.type === 'image/jpeg' || picked.type === 'image/png';
        if (!isPdf && !isImage) {
            fail('Only JPG, PNG or PDF files are allowed');
            return;
        }
        setUploading(true);
        setUploadError('');
        try {
            let toUpload = picked;
            if (isImage) {
                const result = await compressImageForCategory(picked, 'document');
                URL.revokeObjectURL(result.previewUrl);
                toUpload = result.compressedFile;
            }
            if (toUpload.size > STAFF_LOAN_DOCUMENT_MAX_BYTES) {
                throw new Error(`The file is too large (${formatBytes(toUpload.size)}). Maximum size is ${formatBytes(STAFF_LOAN_DOCUMENT_MAX_BYTES)}.`);
            }
            const form = new FormData();
            form.append('file', toUpload);
            for (const [key, fieldValue] of Object.entries(uploadFields ?? {})) form.append(key, fieldValue);
            const res = await apiClient.post<UploadedDocument>(UPLOAD_URL, form);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to upload the document');
            onChange({ fileKey: res.data.fileKey, fileName: res.data.fileName, fileSize: res.data.fileSize });
        } catch (err) {
            fail(err instanceof Error ? err.message : 'Failed to upload the document');
        } finally {
            setUploading(false);
        }
    };

    const busy = uploading || !!disabled;
    const shownError = uploadError || error;

    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{label} {required && <span className="text-destructive">*</span>}</Label>
            <input id={id} ref={inputRef} type="file" accept={STAFF_LOAN_DOCUMENT_ACCEPT} className="hidden" onChange={handleSelected} />
            {value ? (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate font-medium">{value.fileName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(value.fileSize)}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>Replace</Button>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove document" disabled={busy} onClick={() => { setUploadError(''); onChange(null); }}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <Button type="button" variant="outline" className="w-full justify-center gap-2" disabled={busy} onClick={() => inputRef.current?.click()}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? 'Uploading...' : 'Upload image or PDF'}
                </Button>
            )}
            <p className="text-xs text-muted-foreground">{hint ?? 'JPG, PNG or PDF up to 5 MB. Images are compressed automatically.'}</p>
            {shownError && <p className="text-xs text-destructive">{shownError}</p>}
        </div>
    );
}
