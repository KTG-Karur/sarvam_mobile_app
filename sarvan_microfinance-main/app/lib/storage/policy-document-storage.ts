import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';
import { GCS_BASE_FOLDER } from '@/app/lib/storage/gcs-path-resolver';

/**
 * Policy Document Storage
 * ─────────────────────────
 * Unlike EmployeeDocument/insurance/HR-letter storage, a policy applies
 * company-wide — not to one employee's org-hierarchy folder — so this stores
 * under a flat `{GCS_BASE_FOLDER}/policies/{category}/` prefix instead of
 * resolving a branch/employee ancestry path.
 */

export type UploadPolicyDocumentResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

export async function uploadPolicyDocument(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    category?: string | null;
}): Promise<UploadPolicyDocumentResult> {
    const { fileBuffer, contentType, fileName, category } = params;

    const safeCategory = (category || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
    const key = `${GCS_BASE_FOLDER}/policies/${safeCategory}/${timestamp}${extension}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileUrl: key,
        fileName,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}

export async function deletePolicyDocument(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
